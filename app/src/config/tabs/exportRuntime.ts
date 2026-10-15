import {createConfigNamespaceApi} from "../util/namespaceApi";

/** 导出 Tab 命名空间：设置面板注册项 save、stack 内按钮 bind */
export const exportConfigApi = createConfigNamespaceApi<Config.IExport>({
    namespace: "export",
    getConfig: () => window.siyuan.config.export,
    setConfig: data => { window.siyuan.config.export = data; },
    reactions: [{name: "pandoc-path", changed: () => true, apply: (_old, next) => {
        const pathDisplay = document.getElementById("pandocBinPathDisplay");
        if (pathDisplay) pathDisplay.textContent = next.pandocBin || `${window.siyuan.languages.builtIn} Pandoc`;
    }}],
});
