import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
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
    }
}

export const genNotebookOption = (id: string, notebookId?: string, noCurrent?: boolean,
                                  filter?: (item: INotebook) => boolean) => {
    let html = "";
    if (!noCurrent) {
        html = `<option value="">${window.siyuan.languages.currentNotebook}</option>`;
    }
    const helpIds: string[] = [];
    Object.keys(Constants.HELP_PATH).forEach((key: "zh-CN") => {
        helpIds.push(Constants.HELP_PATH[key]);
    });
    const configuredNotebook = window.siyuan.notebooks.find((item) => item.id === id);
    if (noCurrent && id && (!configuredNotebook || helpIds.includes(id) || (filter && !filter(configuredNotebook)))) {
        const name = configuredNotebook?.name || id;
        html += `<option value="${id}" selected disabled>${escapeHtml(name)} (${window.siyuan.languages.agentCapabilitiesUnavailable})</option>`;
    }
    let firstNotebookId = "";
    window.siyuan.notebooks.forEach((item) => {
        if (helpIds.includes(item.id) || item.id === notebookId || (filter && !filter(item))) {
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
    if (noCurrent && !firstNotebookId && !id) {
        html = `<option value="" selected disabled>${window.siyuan.languages.agentCapabilitiesUnavailable}</option>`;
    }
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
    <div class="fn__flex">
        <select class="b3-select fn__size200" id="docCreateSaveBox">${genNotebookOption(data.conf.docCreateSaveBox, data.box)}</select>
        <div class="fn__space"></div>
        <input class="b3-text-field fn__flex-1" id="docCreateSavePath" value="">
    </div>
    <div class="fn__hr"></div>
    <div class="b3-label__text">${window.siyuan.languages.docCreateTemplatePathInheritTip}</div>
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" id="docCreateTemplatePath" value="">
</div>
<div class="b3-label config-item config-item--save-path">
    <div class="config-name">${window.siyuan.languages.fileTree5}</div>
    <div class="b3-label__text">${window.siyuan.languages.fileTree6}</div>
    <span class="fn__hr"></span>
    <div class="fn__flex">
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
    <input class="b3-text-field fn__flex-center fn__block" id="dailyNoteTemplatePath" value="">
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
    contentElement.querySelectorAll("input, select").forEach((item) => {
        item.addEventListener("change", () => {
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
                }
            });
        });
    });
};
