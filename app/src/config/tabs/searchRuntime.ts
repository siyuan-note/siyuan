import {createConfigNamespaceApi} from "../util/namespaceApi";

/** 搜索 Tab 命名空间：设置面板注册项 save */
export const searchConfigApi = createConfigNamespaceApi<Config.ISearch>({
    namespace: "search",
    getConfig: () => window.siyuan.config.search,
    setConfig: (data) => {
        window.siyuan.config.search = data;
    },
    apiPath: "/api/setting/setSearch",
});
