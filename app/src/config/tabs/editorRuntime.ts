import {Constants} from "../../constants";
import {getAllEditor} from "../../layout/getAll";
import {setInlineStyle} from "../../util/assets";
import {reloadProtyle} from "../../protyle/util/reload";
import {resize} from "../../protyle/util/resize";
import {createConfigNamespaceApi} from "../util/namespaceApi";

const applyEditorConfig = (data: Config.IEditor) => {
    window.siyuan.config.editor = data;
    getAllEditor().forEach((editorItem) => {
        const protyle = editorItem.protyle;
        reloadProtyle(protyle, false);
        let isFullWidth = protyle.wysiwyg.element.getAttribute(Constants.CUSTOM_SY_FULLWIDTH);
        if (!isFullWidth) {
            isFullWidth = window.siyuan.config.editor.fullWidth ? "true" : "false";
        }
        if (isFullWidth === "true" && protyle.contentElement.getAttribute("data-fullwidth") === "true") {
            return;
        }
        resize(protyle);
        if (isFullWidth === "true") {
            protyle.contentElement.setAttribute("data-fullwidth", "true");
        } else {
            protyle.contentElement.removeAttribute("data-fullwidth");
        }
    });

    void setInlineStyle();
};

/** 编辑器命名空间：设置面板注册项 save、设置面板外入口共用 */
export const editorConfigApi = createConfigNamespaceApi<Config.IEditor>({
    namespace: "editor",
    getConfig: () => window.siyuan.config.editor,
    setConfig: applyEditorConfig,
    apiPath: "/api/setting/setEditor",
});
