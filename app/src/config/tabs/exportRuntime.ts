import {createConfigNamespaceApi} from "../util/namespaceApi";

const applyExportConfig = (data: Config.IExport) => {
    window.siyuan.config.export = data;
    const pathDisplay = document.getElementById("pandocBinPathDisplay");
    if (pathDisplay) {
        pathDisplay.textContent = data.pandocBin;
    }
};

/** 导出 Tab 命名空间：设置面板注册项 save、stack 内按钮 bind */
export const exportConfigApi = createConfigNamespaceApi<Config.IExport>({
    namespace: "export",
    getConfig: () => window.siyuan.config.export,
    setConfig: applyExportConfig,
    apiPath: "/api/setting/setExport",
});
