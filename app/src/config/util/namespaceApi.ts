import {fetchPost} from "../../util/fetch";
import {createNamespacePatchQueue} from "./namespacePatchQueue";

export function createConfigNamespaceApi<TData>(options: {
    namespace: string;
    getConfig: () => TData;
    setConfig: (data: TData) => void;
    apiPath: string;
    /** 为 true（默认）时 POST 成功后用响应数据 apply 本地 config；为 false 时依赖内核推送到各前端实例 */
    applyFromResponse?: boolean;
}): {
    /**
     * @param onApplied POST 成功后的回调，参数为接口返回的命名空间配置（与 `getConfig()` 同结构）。
     * `applyFromResponse` 为 true 时，调用前已执行 `setConfig`；为 false 时本地 `getConfig()` 可能尚未同步。
     */
    patch: (relOrFullId: string, value: unknown, onApplied?: (data: TData) => void) => void;
    apply: (data: TData) => void;
} {
    const {namespace, getConfig, setConfig, apiPath, applyFromResponse = true} = options;
    const submit = (payload: TData) => new Promise<TData | undefined>((resolve) => {
        let completed = false;
        void fetchPost(apiPath, payload, (response) => {
            completed = true;
            const data = response.data as TData;
            if (applyFromResponse) {
                // 当前修改设置之后内核不推送到所有前端实例，用响应数据更新本地 config
                setConfig(data);
            }
            resolve(data);
        }).finally(() => {
            if (!completed) {
                resolve(undefined);
            }
        });
    });
    const patch = createNamespacePatchQueue({namespace, getConfig, submit});

    return {
        patch,
        apply: setConfig,
    };
}
