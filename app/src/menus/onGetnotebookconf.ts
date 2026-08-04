import {Dialog} from "../dialog";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {escapeHtml} from "../util/escape";
import {writeText} from "../protyle/util/compatibility";
import {showMessage} from "../dialog/message";
import {openModel} from "../mobile/menu/model";
import {Constants} from "../constants";

declare interface INotebookConf {
    name: string,
    box: string,
    conf: {
        refCreateSavePath: string
        docCreateSavePath: string
        dailyNoteSavePath: string
        refCreateSaveBox: string;
        docCreateSaveBox: string;
        docCreateTemplatePath: string;
        dailyNoteTemplatePath: string
        dailyNoteDatabaseID: string
    }
}

export const genNotebookOption = (id: string, notebookId?: string, noCurrent?: boolean) => {
    let html = "";
    if (!noCurrent) {
        html = `<option value="">${window.siyuan.languages.currentNotebook}</option>`;
    }
    const helpIds: string[] = [];
    Object.keys(Constants.HELP_PATH).forEach((key: "zh-CN") => {
        helpIds.push(Constants.HELP_PATH[key]);
    });
    let firstNotebookId = "";
    window.siyuan.notebooks.forEach((item) => {
        if (helpIds.includes(item.id) || item.id === notebookId) {
            return;
        }
        if ("" === firstNotebookId) {
            firstNotebookId = item.id;
        }
        let selected = id === item.id;
        if (noCurrent && "" === id && item.id === firstNotebookId) {
            selected = true;
        }
        html += `<option value="${item.id}" ${selected ? "selected" : ""}>${escapeHtml(item.name)}</option>`;
    });
    return html;
};

export const onGetnotebookconf = (data: INotebookConf) => {
    const titleHTML = `<div class="fn__flex">
<div class="fn__ellipsis" style="white-space: nowrap">${escapeHtml(data.name)}</div>
<div class="fn__space"></div>
<button class="b3-button b3-button--small fn__flex-center">${window.siyuan.languages.copy} ID</button></div>`;
    const contentHTML = `<div class="b3-dialog__content">
<div class="b3-label config-item config-item--save-path">
    <div class="config-name">${window.siyuan.languages.fileTree12}</div>
    <div class="b3-label__text">${window.siyuan.languages.fileTree13}</div>
    <span class="fn__hr"></span>
    <div class="fn__flex config-wrap">
        <select class="b3-select fn__size200" id="docCreateSaveBox">${genNotebookOption(data.conf.docCreateSaveBox, data.box)}</select>
        <div class="fn__space"></div>
        <input class="b3-text-field fn__flex-1" id="docCreateSavePath" value="">
    </div>
    <div class="fn__hr"></div>
    <div class="b3-label__text">${window.siyuan.languages.docCreateTemplatePathInheritTip}</div>
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" id="docCreateTemplatePath" value="${data.conf.docCreateTemplatePath}">
</div>
<div class="b3-label config-item config-item--save-path">
    <div class="config-name">${window.siyuan.languages.fileTree5}</div>
    <div class="b3-label__text">${window.siyuan.languages.fileTree6}</div>
    <span class="fn__hr"></span>
    <div class="fn__flex config-wrap">
        <select class="b3-select fn__size200" id="refCreateSaveBox">${genNotebookOption(data.conf.refCreateSaveBox, data.box)}</select>
        <div class="fn__space"></div>
        <input class="b3-text-field fn__flex-1" id="refCreateSavePath" value="">
    </div>
</div>
<div class="b3-label config-item">
    <div class="config-name">${window.siyuan.languages.fileTree11}</div>
    <div class="b3-label__text">${window.siyuan.languages.fileTree14}</div>
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" id="dailyNoteSavePath" value="">
    <div class="fn__hr"></div>
    <div class="b3-label__text">${window.siyuan.languages.fileTree15}</div>
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" id="dailyNoteTemplatePath" value="${data.conf.dailyNoteTemplatePath}">
    <div class="fn__hr"></div>
    <div class="b3-label__text">${window.siyuan.languages.dailyNoteDatabaseIdHint}</div>
    <div class="fn__hr"></div>
    <div class="fn__flex" style="align-items: center; gap: 8px">
        <input class="b3-text-field fn__flex-1" id="dailyNoteDatabaseId" value="" readonly placeholder="${window.siyuan.languages.dailyNoteDatabaseId}">
        <button class="b3-button b3-button--outline" id="dailyNoteDatabasePick">${window.siyuan.languages.dailyNoteDatabasePick}</button>
    </div>
</div></div>`;
    if (isMobile()) {
        openModel({
            title: titleHTML,
            icon: "iconSettings",
            html: `<div>${contentHTML}</div>`,
            bindEvent() {
                bindSettingEvent(document.querySelector("#model"), data);
            }
        });
    } else {
        const dialog = new Dialog({
            width: "80vw",
            title: titleHTML,
            content: contentHTML
        });
        dialog.element.setAttribute("data-key", Constants.DIALOG_NOTEBOOKCONF);
        bindSettingEvent(dialog.element, data);
    }
};

const bindSettingEvent = (contentElement: Element, data: INotebookConf) => {
    contentElement.querySelector(".b3-button--small").addEventListener("click", () => {
        writeText(data.box);
        showMessage(window.siyuan.languages.copied);
    });
    const dailyNoteSavePathElement = contentElement.querySelector("#dailyNoteSavePath") as HTMLInputElement;
    dailyNoteSavePathElement.value = data.conf.dailyNoteSavePath;
    const docCreateSavePathElement = contentElement.querySelector("#docCreateSavePath") as HTMLInputElement;
    docCreateSavePathElement.value = data.conf.docCreateSavePath;
    const docCreateTemplatePathElement = contentElement.querySelector("#docCreateTemplatePath") as HTMLInputElement;
    docCreateTemplatePathElement.value = data.conf.docCreateTemplatePath;
    const refCreateSavePathElement = contentElement.querySelector("#refCreateSavePath") as HTMLInputElement;
    refCreateSavePathElement.value = data.conf.refCreateSavePath;
    const dailyNoteTemplatePathElement = contentElement.querySelector("#dailyNoteTemplatePath") as HTMLInputElement;
    dailyNoteTemplatePathElement.value = data.conf.dailyNoteTemplatePath;
    const dailyNoteDatabaseIdElement = contentElement.querySelector("#dailyNoteDatabaseId") as HTMLInputElement;
    dailyNoteDatabaseIdElement.dataset.id = data.conf.dailyNoteDatabaseID || "";
    if (data.conf.dailyNoteDatabaseID) {
        fetchSyncPost("/api/av/searchAttributeView", {keyword: "", avID: "", blockID: "", excludes: []}).then((response) => {
            const results = (response?.data?.results || []) as Array<{avID: string, avName: string, blockID: string, hPath: string}>;
            const result = results.find((item) => item.blockID === data.conf.dailyNoteDatabaseID);
            if (result) {
                dailyNoteDatabaseIdElement.value = `${result.avName}${result.hPath ? " · " + result.hPath : ""}`;
            } else {
                dailyNoteDatabaseIdElement.value = data.conf.dailyNoteDatabaseID;
            }
        });
    }
    const dailyNoteDatabasePickElement = contentElement.querySelector("#dailyNoteDatabasePick") as HTMLButtonElement;
    const saveConf = () => {
        fetchPost("/api/notebook/setNotebookConf", {
            notebook: data.box,
            conf: {
                refCreateSavePath: refCreateSavePathElement.value,
                refCreateSaveBox: (contentElement.querySelector("#refCreateSaveBox") as HTMLInputElement).value,
                docCreateSaveBox: (contentElement.querySelector("#docCreateSaveBox") as HTMLInputElement).value,
                docCreateSavePath: docCreateSavePathElement.value,
                docCreateTemplatePath: docCreateTemplatePathElement.value,
                dailyNoteSavePath: dailyNoteSavePathElement.value,
                dailyNoteTemplatePath: dailyNoteTemplatePathElement.value,
                dailyNoteDatabaseID: dailyNoteDatabaseIdElement.dataset.id || "",
            }
        });
    };
    contentElement.querySelectorAll("input, select").forEach((item) => {
        item.addEventListener("change", () => {
            saveConf();
        });
    });
    dailyNoteDatabasePickElement.addEventListener("click", () => {
        fetchSyncPost("/api/av/searchAttributeView", {keyword: "", avID: "", blockID: "", excludes: []}).then((response) => {
            const results = (response?.data?.results || []) as Array<{avID: string, avName: string, blockID: string, hPath: string}>;
            const nameById = new Map(results.map(item => [item.blockID, item.avName]));
            const listHTML = results.map((item) => {
                const location = item.hPath ? `<span class="b3-list-item__meta">${escapeHtml(item.hPath)}</span>` : "";
                return `<div class="b3-list-item b3-list-item--outline fn__pointer" data-id="${item.blockID}" role="button" tabindex="0">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconDatabase"></use></svg>
    <span class="b3-list-item__text">${escapeHtml(item.avName)}${location}</span>
</div>`;
            }).join("");
            const picker = new Dialog({
                title: window.siyuan.languages.dailyNoteDatabaseId,
                content: `<div class="b3-dialog__content"><div class="b3-list b3-list--background">
<div class="b3-list-item b3-list-item--outline fn__pointer" data-id="" role="button" tabindex="0">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconClose"></use></svg>
    <span class="b3-list-item__text">${window.siyuan.languages.clear}</span>
</div>${listHTML}</div></div>`,
                width: isMobile() ? "92vw" : "640px",
            });
            picker.element.setAttribute("data-key", "dialog-dailynote-database");
            picker.element.querySelectorAll(".b3-list-item").forEach((item) => {
                item.addEventListener("click", () => {
                    const blockID = item.getAttribute("data-id") || "";
                    dailyNoteDatabaseIdElement.dataset.id = blockID;
                    dailyNoteDatabaseIdElement.value = blockID ? (nameById.get(blockID) || blockID) : "";
                    saveConf();
                    picker.destroy();
                });
            });
        });
    });
};
