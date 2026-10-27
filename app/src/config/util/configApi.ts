import {fetchSyncPost} from "../../util/fetch";
import {mergeRecordByDottedPath} from "./dotPath";
import {refreshSettingConfigAfter} from "../setting/sync";
import {trackSettingSave} from "../setting/pending";

const pending = new Map<string, Promise<void>>();

const get = <T>(path: string): T => {
    let value: unknown = window.siyuan.config;
    for (const key of path.split(".")) {
        if (!value || typeof value !== "object") {
            return undefined;
        }
        value = Reflect.get(value, key);
    }
    return value as T;
};

// 同一配置段按提交顺序保存，成功后通过统一刷新流程应用内核的规范化结果。
const set = (path: string, value: unknown, onApplied?: (data: unknown, response?: IWebSocketData) => void): Promise<void> => {
    // Configuration is JSON data; take the request snapshot without newer WebView APIs.
    value = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const separator = path.indexOf(".");
    const namespace = separator === -1 ? path : path.slice(0, separator);
    const relativePath = separator === -1 ? "" : path.slice(separator + 1);
    const patch = relativePath ? mergeRecordByDottedPath({}, relativePath, value) : value;
    const operation = (pending.get(namespace) || Promise.resolve()).catch(() => {}).then(async () => {
        let response: IWebSocketData;
        const save = async () => {
            response = await submit(path, value, namespace, patch);
            if (response.code !== 0) {
                throw new Error(response.msg);
            }
            return true;
        };
        const changed = namespace === "graph" && window.siyuan.config.readonly ? await save() :
            await refreshSettingConfigAfter(["api", "oidc", "accessAuthCode"].includes(namespace) ? "system" : namespace, save);
        if (changed) {
            onApplied?.(get(namespace), response);
        }
    });
    pending.set(namespace, operation);
    void operation.finally(() => {
        if (pending.get(namespace) === operation) {
            pending.delete(namespace);
        }
    }).catch(() => {});
    const tracked = trackSettingSave(operation);
    void tracked.catch(() => {});
    return tracked;
};

// 凭据校验、全局状态和插件生命周期保留专用协议，但共用排队与刷新入口。
const submit = (path: string, value: unknown, namespace: string, patch: unknown): Promise<IWebSocketData> => {
    switch (path) {
        case "system.downloadInstallPkg":
            return fetchSyncPost("/api/system/setDownloadInstallPkg", {downloadInstallPkg: Boolean(value)});
        case "system.updateChannel":
            return fetchSyncPost("/api/system/setUpdateChannel", {updateChannel: value as Config.TUpdateChannel});
        case "api.token":
            return fetchSyncPost("/api/system/setAPIToken", {token: String(value)});
        case "accessAuthCode":
            return fetchSyncPost("/api/system/setAccessAuthCode", {accessAuthCode: String(value)});
        case "oidc":
            return fetchSyncPost("/api/system/setOIDC", value as Config.IOIDC);
        case "bazaar.petalDisabled":
            return fetchSyncPost("/api/setting/setBazaarPetalDisabled", {petalDisabled: Boolean(value)});
        // 关系图专用接口允许来宾与只读用户使用当前界面的临时偏好。
        case "graph.global":
            return fetchSyncPost("/api/graph/setGraphConf", {type: "global", conf: value as Config.IGraph["global"]});
        case "graph.local":
            return fetchSyncPost("/api/graph/setGraphConf", {type: "local", conf: value as Config.IGraph["local"]});
        default:
            return fetchSyncPost("/api/setting/patch", {[namespace]: patch});
    }
};

export const config = {get, set};
