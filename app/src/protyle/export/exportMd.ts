import {Constants} from "../../constants";
import {Dialog} from "../../dialog";
import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {isMobile} from "../../util/functions";
import {isEncryptedBox} from "../../util/pathName";
import {saveExportFile} from "../util/compatibility";

// 导出参数对话框 https://github.com/siyuan-note/siyuan/issues/17031
// 通用部分（8 项）可被各导出格式复用，Markdown 专属部分仅 Markdown 导出使用。
// 默认值一律取自全局 window.siyuan.config.export，确认后本次导出生效，不修改全局设置、不记忆上次选择。

// 类型别名：约束字段 key 与 Config.IExport 的字段类型对应，避免用 string 索引报错
type BoolKey = "addTitle" | "inlineMemo" | "includeSubDocs" | "includeRelatedDocs" | "markdownYFM" | "removeAssetsID";
type IntKey = "blockRefMode" | "blockEmbedMode" | "fileAnnotationRefMode";
type StringKey = "blockRefTextLeft" | "blockRefTextRight" | "tagOpenMarker" | "tagCloseMarker";

interface IExportMdOptions {
    id?: string;
    ids?: string[];
    notebook?: string;
}

// openExportOptionsDialog 渲染「通用 + Markdown 专属」两组开关，确认时回调 onConfirm 传出全部 13 项。
// showSubDocs/showRelatedDocs 控制是否显示「包含子文档/关联文档」项（单文档无对应内容时隐藏）。
export const openExportOptionsDialog = (onConfirm: (options: IExportMdOptionsPayload) => void, showSubDocs = true, showRelatedDocs = true) => {
    const conf = window.siyuan.config.export;
    const bool = (id: BoolKey) => `<input id="${id}" class="b3-switch fn__flex-center" type="checkbox" ${conf[id] ? "checked" : ""}>`;
    // 渲染 select：复用设置面板的标准 class（fn__flex-center fn__size200），value 为当前全局值时标记 selected
    const select = (id: IntKey, options: {value: number; label: string}[]) => {
        const opts = options.map(o =>
            `<option value="${o.value}" ${conf[id] === o.value ? "selected" : ""}>${o.label}</option>`).join("");
        return `<select id="${id}" class="b3-select fn__flex-center fn__size200">${opts}</select>`;
    };
    // 一行：左侧标题+说明，右侧控件。复用设置面板标准布局 class（config-item config-wrap）
    const row = (title: string, desc: string, control: string) =>
        `<label class="fn__flex b3-label config-item config-wrap">
            <div class="fn__flex-1">
                <div class="config-name">${title}</div>
                <div class="b3-label__text">${desc}</div>
            </div>
            <span class="fn__space"></span>
            ${control}
        </label>`;
    // 左右两个输入框，复用设置面板标准宽度 class（fn__size96）
    const textPair = (leftId: StringKey, rightId: StringKey) =>
        `<input id="${leftId}" class="b3-text-field fn__flex-center fn__size96" value="${conf[leftId] ?? ""}">
        <span class="fn__space"></span>
        <input id="${rightId}" class="b3-text-field fn__flex-center fn__size96" value="${conf[rightId] ?? ""}">`;

    const dialog = new Dialog({
        title: window.siyuan.languages.export + " Markdown",
        content: `<div class="b3-dialog__content export-md__content">
    <!-- 常用 -->
    ${row(window.siyuan.languages.export17, window.siyuan.languages.export18, bool("addTitle"))}
    ${showSubDocs ? row(window.siyuan.languages.includeSubDocs, window.siyuan.languages.includeSubDocsTip, bool("includeSubDocs")) : ""}
    ${showRelatedDocs ? row(window.siyuan.languages.includeRelatedDocs, window.siyuan.languages.includeRelatedDocsTip, bool("includeRelatedDocs")) : ""}
    ${row(window.siyuan.languages.export23, window.siyuan.languages.export24, bool("markdownYFM"))}
    ${row(window.siyuan.languages.removeAssetsID, window.siyuan.languages.removeAssetsIDTip, bool("removeAssetsID"))}
    <!-- 其他 -->
    ${row(window.siyuan.languages.export31, window.siyuan.languages.export32, bool("inlineMemo"))}
    ${row(window.siyuan.languages.ref, window.siyuan.languages.export11,
        select("blockRefMode", [
            {value: 2, label: window.siyuan.languages.export2},
            {value: 3, label: window.siyuan.languages.export3},
            {value: 4, label: window.siyuan.languages.export4},
        ]))}
    ${row(window.siyuan.languages.blockEmbed, window.siyuan.languages.export12,
        select("blockEmbedMode", [
            {value: 0, label: window.siyuan.languages.export0},
            {value: 1, label: window.siyuan.languages.export1},
        ]))}
    ${row(window.siyuan.languages.export5, window.siyuan.languages.export6,
        select("fileAnnotationRefMode", [
            {value: 0, label: window.siyuan.languages.export7},
            {value: 1, label: window.siyuan.languages.export8},
        ]))}
    ${row(window.siyuan.languages.export13, window.siyuan.languages.export14,
        textPair("blockRefTextLeft", "blockRefTextRight"))}
    ${row(window.siyuan.languages.export15, window.siyuan.languages.export16,
        textPair("tagOpenMarker", "tagCloseMarker"))}
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: "520px",
        height: isMobile() ? "70vh" : "60vh",
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_EXPORTMARKDOWN);

    const el = dialog.element;
    // 控件可能未渲染（如无子文档时），此时回退到全局配置值
    const boolVal = (id: BoolKey) => {
        const input = el.querySelector("#" + id) as HTMLInputElement;
        return input ? input.checked : conf[id];
    };
    const collect = (): IExportMdOptionsPayload => ({
        addTitle: (el.querySelector("#addTitle") as HTMLInputElement).checked,
        inlineMemo: (el.querySelector("#inlineMemo") as HTMLInputElement).checked,
        blockRefMode: parseInt((el.querySelector("#blockRefMode") as HTMLSelectElement).value, 10),
        blockEmbedMode: parseInt((el.querySelector("#blockEmbedMode") as HTMLSelectElement).value, 10),
        fileAnnotationRefMode: parseInt((el.querySelector("#fileAnnotationRefMode") as HTMLSelectElement).value, 10),
        blockRefTextLeft: (el.querySelector("#blockRefTextLeft") as HTMLInputElement).value,
        blockRefTextRight: (el.querySelector("#blockRefTextRight") as HTMLInputElement).value,
        tagOpenMarker: (el.querySelector("#tagOpenMarker") as HTMLInputElement).value,
        tagCloseMarker: (el.querySelector("#tagCloseMarker") as HTMLInputElement).value,
        includeSubDocs: boolVal("includeSubDocs"),
        includeRelatedDocs: boolVal("includeRelatedDocs"),
        markdownYFM: (el.querySelector("#markdownYFM") as HTMLInputElement).checked,
        removeAssetsID: (el.querySelector("#removeAssetsID") as HTMLInputElement).checked,
    });

    const btnsElement = el.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        const payload = collect();
        dialog.destroy();
        onConfirm(payload);
    });
};

interface IExportMdOptionsPayload {
    addTitle: boolean;
    inlineMemo: boolean;
    blockRefMode: number;
    blockEmbedMode: number;
    fileAnnotationRefMode: number;
    blockRefTextLeft: string;
    blockRefTextRight: string;
    tagOpenMarker: string;
    tagCloseMarker: string;
    includeSubDocs: boolean;
    includeRelatedDocs: boolean;
    markdownYFM: boolean;
    removeAssetsID: boolean;
}

// exportMarkdownZip 为 Markdown .zip 导出入口：弹参数对话框，确认后按 id/ids/notebook 调对应 API。
// 单文档时先查询文档信息，若无子文档/关联文档则隐藏对应配置项，减少干扰。
export const exportMarkdownZip = async(options: IExportMdOptions) => {
    let showSubDocs = true;
    let showRelatedDocs = true;
    let encrypted = false;
    if (options.id) {
        // 查询文档是否有子文档、引用及绑定的数据库，无则隐藏对应配置项 #17031
        const docInfo = await fetchSyncPost("/api/block/getDocInfo", {id: options.id});
        const data = docInfo.data;
        showSubDocs = 0 < data.subFileCount;
        showRelatedDocs = 0 < (data.refCount || 0) || 0 < (data.attrViews?.length || 0);
        const blockInfo = await fetchSyncPost("/api/block/getBlockInfo", {id: options.id});
        encrypted = blockInfo.code === 0 && isEncryptedBox(blockInfo.data.box);
    }
    openExportOptionsDialog(params => {
        const exportMarkdown = () => {
        const msgId = showMessage(window.siyuan.languages.exporting, -1);
        const cb = (response: IWebSocketData) => saveExportFile(response.data.zip, msgId);
        if (options.id) {
            fetchPost("/api/export/exportMd", {id: options.id, ...params}, cb);
        } else if (options.ids) {
            fetchPost("/api/export/exportMds", {ids: options.ids, ...params}, cb);
        } else {
            fetchPost("/api/export/exportNotebookMd", {notebook: options.notebook, ...params}, cb);
        }
        };
        if (encrypted) {
            confirmDialog("⚠️ " + window.siyuan.languages.export, window.siyuan.languages.encryptedExportRiskTip, exportMarkdown);
            return;
        }
        exportMarkdown();
    }, showSubDocs, showRelatedDocs);
};
