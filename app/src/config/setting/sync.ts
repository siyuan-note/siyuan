import {fetchSyncPost} from "../../util/fetch";
import {systemConfig} from "../systemConfig";
import {editorConfigApi} from "../tabs/editorRuntime";
import {appearanceConfigApi} from "../tabs/appearanceRuntime";
import {aiConfigApi} from "../tabs/ai/aiRuntime";
import {objEquals} from "../../util/functions";
import {syncSettingTasks} from "./taskBlocker";
import {processSync} from "../../dialog/processSystem";
/// #if !MOBILE
import {applyKeymap} from "../tabs/keymapRuntime";
import {remountOpenSettingTab} from "./mount";
import {getSettingTabDefs, type TSettingTab} from "./tabs";
/// #endif

let pending = new Set<string>();
let refreshing: Promise<void>;

// 合并通知并串行读取，重连也使用同一流程，避免旧响应覆盖更新后的配置。
export const refreshSettingConfig = (namespace = "*"): Promise<void> => {
    pending.add(namespace);
    if (refreshing) {
        return refreshing;
    }
    refreshing = (async () => {
        while (pending.size) {
            const namespaces = pending;
            pending = new Set();
            const response = await fetchSyncPost("/api/system/getConf", {});
            if (response.code !== 0 || !window.siyuan.config) {
                continue;
            }
            const next = systemConfig(response.data.conf);
            syncSettingTasks(response.data.settingTasks);
            const includes = (key: string) => namespaces.has("*") || namespaces.has(key);
            if (includes("editor") && !objEquals(window.siyuan.config.editor, next.editor)) {
                editorConfigApi.apply(next.editor);
            }
            if (includes("appearance") && !objEquals(window.siyuan.config.appearance, next.appearance)) {
                appearanceConfigApi.apply(next.appearance);
            }
            if (includes("ai") && !objEquals(window.siyuan.config.ai, next.ai)) {
                aiConfigApi.apply(next.ai);
            }
            if (includes("sync") && !objEquals(window.siyuan.config.sync, next.sync)) {
                window.siyuan.config.sync = next.sync;
                processSync();
            }
            let accessChanged = false;
            if (includes("system")) {
                // 系统设置通知同时同步访问授权的顶层配置，值以内核返回的脱敏配置为准。
                for (const key of ["api", "oidc", "accessAuthCode"] as const) {
                    accessChanged ||= !objEquals(window.siyuan.config[key], next[key]);
                    Object.assign(window.siyuan.config, {[key]: next[key]});
                }
            }
            /// #if !MOBILE
            if (includes("keymap") && !objEquals(window.siyuan.config.keymap, next.keymap)) {
                applyKeymap(next.keymap);
            }
            /// #else
            if (includes("keymap")) {
                window.siyuan.config.keymap = next.keymap;
            }
            /// #endif
            const simple = ["export", "fileTree", "search", "flashcard", "secrets", "variables", "repo", "system", "bazaar", "publish"] as const;
            for (const key of simple) {
                if (includes(key)) {
                    Object.assign(window.siyuan.config, {[key]: next[key]});
                }
            }
            /// #if !MOBILE
            const tabs: Record<string, TSettingTab> = {fileTree: "file", secrets: "secretsVariables", variables: "secretsVariables", system: "app", publish: "access"};
            const remountTabs = new Set<TSettingTab>();
            for (const namespace of namespaces.has("*") ? [...simple, "editor", "keymap", "appearance", "ai", "sync"] : namespaces) {
                const tab = getSettingTabDefs().find(definition => definition.id === (tabs[namespace] || namespace));
                if (tab) remountTabs.add(tab.id);
            }
            if (accessChanged) remountTabs.add("access");
            remountTabs.forEach(tab => { void remountOpenSettingTab(tab); });
            /// #endif
        }
    })().catch(error => console.error("Could not refresh settings", error)).finally(() => {
        refreshing = undefined;
        if (pending.size) return refreshSettingConfig();
    });
    return refreshing;
};
