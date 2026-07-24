import {Constants} from "../../constants";
import {getAllEditor, getAllModels} from "../../layout/getAll";
import {refreshHeadingNumberMeasurements, setInlineStyle} from "../../util/assets";
import {reloadProtyle} from "../../protyle/util/reload";
import {resize} from "../../protyle/util/resize";
import {createConfigNamespaceApi} from "../util/namespaceApi";

const applyEditorConfig = (data: Config.IEditor) => {
    const refreshDatabaseRowLayout = window.siyuan.config.editor.fullWidth !== data.fullWidth;
    const refreshHeadingNumbers = window.siyuan.config.editor.headingNumber !== data.headingNumber ||
        window.siyuan.config.editor.headingNumberFormat !== data.headingNumberFormat;
    const remeasureHeadingNumbers = window.siyuan.config.editor.fontSize !== data.fontSize ||
        window.siyuan.config.editor.fontFamily !== data.fontFamily ||
        window.siyuan.config.editor.fontWeight !== data.fontWeight;
    window.siyuan.config.editor = data;
    const models = getAllModels();
    models.editor.forEach(item => item.updateBacklinkPanel());
    if (refreshDatabaseRowLayout) {
        models.custom.forEach(item => {
            if (item.type === "siyuan-database-row") {
                item.resize?.();
            }
        });
    }
    getAllEditor().forEach((editorItem) => {
        const protyle = editorItem.protyle;
        protyle.databaseAttributePanel?.updateDisplayConfig();
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
    if (refreshHeadingNumbers) {
        /// #if MOBILE
        window.siyuan.mobile.docks.outline?.reload();
        /// #else
        models.outline.forEach(item => item.refresh());
        /// #endif
    }

    void setInlineStyle().then(() => {
        if (remeasureHeadingNumbers && data.headingNumber) {
            refreshHeadingNumberMeasurements();
        }
    });
};

/** 编辑器命名空间：设置面板注册项 save、设置面板外入口共用 */
export const editorConfigApi = createConfigNamespaceApi<Config.IEditor>({
    namespace: "editor",
    getConfig: () => window.siyuan.config.editor,
    setConfig: applyEditorConfig,
    apiPath: "/api/setting/setEditor",
});
