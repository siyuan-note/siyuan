import {fetchPost} from "../../util/fetch";
import {mergeRecordByDottedPath} from "./dotPath";

export function createConfigNamespaceApi<TData>(options: {
    namespace: string;
    getConfig: () => TData;
    setConfig: (data: TData) => void;
    apiPath: string;
    /** 为 true（默认）时 POST 成功后用响应数据 apply 本地 config；为 false 时依赖内核推送到各前端实例 */
    applyFromResponse?: boolean;
}): {
    patch: (relOrFullId: string, value: unknown) => void;
    apply: (data: TData) => void;
} {
    const {namespace, getConfig, setConfig, apiPath, applyFromResponse = true} = options;
    const prefix = `${namespace}.`;

    const post = (payload: TData) => {
        fetchPost(apiPath, payload, (response) => {
            if (!applyFromResponse) {
                return;
            }
            // 当前修改设置之后内核不推送到所有前端实例，用响应数据更新本地 config
            setConfig(response.data);
        });
    };

    return {
        patch(relOrFullId, value) {
            const rel = relOrFullId.startsWith(prefix) ? relOrFullId.slice(prefix.length) : relOrFullId;
            if (rel) {
                const prev = getConfig() as unknown as Record<string, unknown>;
                post(mergeRecordByDottedPath(prev, rel, value) as unknown as TData);
            }
        },
        apply: setConfig,
    };
}
