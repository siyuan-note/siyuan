import {createConfigNamespaceApi} from "../util/namespaceApi";

/** 闪卡 Tab 命名空间：设置面板注册项 save */
export const flashcardConfigApi = createConfigNamespaceApi<Config.IFlashCard>({
    namespace: "flashcard",
    getConfig: () => window.siyuan.config.flashcard,
    setConfig: (data) => {
        window.siyuan.config.flashcard = data;
    },
    apiPath: "/api/setting/setFlashcard",
});
