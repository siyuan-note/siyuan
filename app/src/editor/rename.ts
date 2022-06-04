import {showMessage} from "../dialog/message";
import {Dialog} from "../dialog";
import {focusByRange} from "../protyle/util/selection";
import {hasClosestBlock} from "../protyle/util/hasClosest";
import {removeEmbed} from "../protyle/wysiwyg/removeEmbed";
import {insertHTML} from "../protyle/util/insertHTML";
import {genEmptyBlock} from "../block/util";
import {isMobile} from "../util/functions";
import {getDisplayName, pathPosix, setNotebookName} from "../util/pathName";
import {fetchPost} from "../util/fetch";
import {escapeHtml} from "../util/escape";

export const validateName = (name: string) => {
    if (/\r\n|\r|\n|\u2028|\u2029|\t|\//.test(name)) {
        showMessage(window.siyuan.languages.fileNameRule);
        return false;
    }
    return true;
};

export const replaceFileName = (name: string) => {
    return name.replace(/\r\n|\r|\n|\u2028|\u2029|\t|\//g, "").trim();
};

export const rename = (options: {
    path: string
    notebookId: string
    name: string,
    type: "notebook" | "file"
    range?: Range,
}) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.rename,
        content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" value=""></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "80vw" : "520px",
        destroyCallback() {
            if (options.range) {
                focusByRange(options.range);
            }
        }
    });
    const inputElement = dialog.element.querySelector("input") as HTMLInputElement;
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    dialog.bindInput(inputElement, () => {
        (btnsElement[1] as HTMLButtonElement).click();
    });
    inputElement.value = Lute.UnEscapeHTMLStr(options.name);
    inputElement.focus();
    inputElement.select();
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        if (!validateName(inputElement.value)) {
            return false;
        }
        if (inputElement.value === options.name) {
            dialog.destroy();
            return false;
        }
        if (inputElement.value.trim() === "") {
            inputElement.value = "Untitled";
        } else {
            inputElement.value = replaceFileName(inputElement.value);
        }
        if (options.type === "notebook") {
            fetchPost("/api/notebook/renameNotebook", {
                notebook: options.notebookId,
                name: inputElement.value
            }, () => {
                setNotebookName(options.notebookId, inputElement.value);
            });
        } else {
            fetchPost("/api/filetree/renameDoc", {
                notebook: options.notebookId,
                path: options.path,
                title: inputElement.value,
            });
        }
        dialog.destroy();
    });
};

export const newFileContentBySelect = (protyle: IProtyle) => {
    if (getSelection().rangeCount === 0) {
        return;
    }
    const range = getSelection().getRangeAt(0);
    const nodeElement = hasClosestBlock(range.startContainer);
    if (!nodeElement) {
        return;
    }
    let nodeElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
    if (nodeElements.length === 0) {
        nodeElements = [nodeElement];
    }
    let html = "";
    let fileNameShort = range.toString();
    if (fileNameShort === "") {
        fileNameShort = nodeElements[0].textContent;
        nodeElements.forEach(item => {
            html += removeEmbed(item);
        });
        if (!fileNameShort) {
            return;
        }
    } else {
        const tempElement = document.createElement("div");
        tempElement.appendChild(range.cloneContents());
        html = tempElement.innerHTML;
    }
    if (fileNameShort.length > 10) {
        fileNameShort = fileNameShort.substr(0, 10) + "...";
    }
    fileNameShort = replaceFileName(fileNameShort);
    fetchPost("/api/filetree/createDoc", {
        notebook: protyle.notebookId,
        path: pathPosix().join(getDisplayName(protyle.path, false, true), Lute.NewNodeID() + ".sy"),
        title: fileNameShort,
        md: protyle.lute.BlockDOM2StdMd(html)
    });
};

export const newFileBySelect = (fileName: string, protyle: IProtyle) => {
    fileName = replaceFileName(fileName);
    const id = Lute.NewNodeID();
    fetchPost("/api/filetree/createDoc", {
        notebook: protyle.notebookId,
        path: pathPosix().join(getDisplayName(protyle.path, false, true), id+ ".sy"),
        title: fileName,
        md: ""
    }, () => {
        insertHTML(genEmptyBlock(false, false, `<span data-type="block-ref" data-id="${id}" data-subtype="d">${escapeHtml(fileName)}</span>`), protyle);
    });
};
