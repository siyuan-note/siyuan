import {createConfigNamespaceApi} from "../../util/namespaceApi";

export const AI_CONFIG_CHANGED_EVENT = "siyuan-ai-config-changed";

/** AI Tab 命名空间：设置面板注册项 save */
const aiConfigNamespaceApi = createConfigNamespaceApi<Config.IAI>({
    namespace: "ai",
    getConfig: () => window.siyuan.config.ai,
    setConfig: (data) => {
        window.siyuan.config.ai = data;
    },
    apiPath: "/api/setting/setAI",
});

export const aiConfigApi = {
    patch(relOrFullId: string, value: unknown, onApplied?: (data: Config.IAI) => void) {
        aiConfigNamespaceApi.patch(relOrFullId, value, (data) => {
            window.dispatchEvent(new CustomEvent(AI_CONFIG_CHANGED_EVENT));
            onApplied?.(data);
        });
    },
    apply(data: Config.IAI) {
        aiConfigNamespaceApi.apply(data);
        window.dispatchEvent(new CustomEvent(AI_CONFIG_CHANGED_EVENT));
    },
};
