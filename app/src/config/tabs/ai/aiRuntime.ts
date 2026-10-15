import {createConfigNamespaceApi} from "../../util/namespaceApi";

export const AI_CONFIG_CHANGED_EVENT = "siyuan-ai-config-changed";

let pendingSave = Promise.resolve(true);

/** AI Tab 命名空间：设置面板注册项 save */
const aiConfigNamespaceApi = createConfigNamespaceApi<Config.IAI>({
    namespace: "ai",
    getConfig: () => window.siyuan.config.ai,
    setConfig: (data) => {
        window.siyuan.config.ai = data;
    },
    reactions: [{name: "model-pickers", changed: () => true, apply: () => {
        window.dispatchEvent(new CustomEvent(AI_CONFIG_CHANGED_EVENT));
    }}],
});

export const aiConfigApi = {
    patch(relOrFullId: string, value: unknown, onApplied?: (data: Config.IAI) => void) {
        let applied = false;
        const task = aiConfigNamespaceApi.patch(relOrFullId, value, (data) => {
            applied = true;
            onApplied?.(data);
        });
        pendingSave = task.then(() => applied, () => false);
        return task;
    },
    waitForSave() {
        return pendingSave;
    },
    apply(data: Config.IAI) {
        return aiConfigNamespaceApi.apply(data);
    },
};
