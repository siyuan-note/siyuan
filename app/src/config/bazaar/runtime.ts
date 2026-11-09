import {createConfigNamespaceApi} from "../util/namespaceApi";

export const bazaarConfigApi = createConfigNamespaceApi<Config.IBazaar>({
    namespace: "bazaar",
    getConfig: () => window.siyuan.config.bazaar,
    setConfig: (data) => {
        window.siyuan.config.bazaar = data;
    },
});
