import {showMessage} from "../dialog/message";
import {Dialog} from "../dialog";
import {focusByRange} from "../protyle/util/selection";
import {hasClosestBlock} from "../protyle/util/hasClosest";
import {removeEmbed} from "../protyle/wysiwyg/removeEmbed";
import {isMobile} from "../util/functions";
import {getAssetName, getDisplayName, pathPosix, setNotebookName} from "../util/pathName";
import {fetchPost} from "../util/fetch";
import {Constants} from "../constants";
import {showTooltip} from "../dialog/tooltip";
/// #if !MOBILE
import {getAllEditor, getAllModels} from "../layout/getAll";
import {getCurrentEditor} from "../mobile/editor";
/// #endif

export const validateName = (name: string, targetElement?: HTMLElement) => {
    if (/\r\n|\r|\n|\u2028|\u2029|\t|\//.test(name)) {
        if (targetElement) {
            showTooltip(window.siyuan.languages.fileNameRule, targetElement, true);
        } else {
            showMessage(window.siyuan.languages.fileNameRule);
        }
        return false;
    }
    if (name.length > Constants.SIZE_TITLE) {
        if (targetElement) {
            showTooltip(window.siyuan.languages["_kernel"]["106"], targetElement, true);
        } else {
            showMessage(window.siyuan.languages["_kernel"]["106"]);
        }
        return false;
    }
    return true;
};

export const replaceFileName = (name: string) => {
    return name.replace(/\r\n|\r|\n|\u2028|\u2029|\t|\//g, "").substring(0, Constants.SIZE_TITLE);
};

export const replaceLocalPath = (name: string) => {
    return name.replace(/\\\\|\/|"|:|\*|\?|\\|'|<|>|\|/g, "");
};

export const rename = (options: {
    path: string
    notebookId: string
    name: string,
    type: "notebook" | "file"
    range?: Range,
}) => {
    if (window.siyuan.config.readonly) {
        return;
    }
    const dialog = new Dialog({
        title: window.siyuan.languages.rename,
        content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" value=""></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
        destroyCallback() {
            if (options.range) {
                focusByRange(options.range);
            }
        }
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_RENAME);
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
            inputElement.value = window.siyuan.languages.untitled;
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

export const renameAsset = (assetPath: string) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.rename,
        content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" value=""></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_RENAMEASSETS);
    const inputElement = dialog.element.querySelector("input") as HTMLInputElement;
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    dialog.bindInput(inputElement, () => {
        (btnsElement[1] as HTMLButtonElement).click();
    });
    const oldName = getAssetName(assetPath);
    inputElement.value = oldName;
    inputElement.focus();
    inputElement.select();
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        if (inputElement.value === oldName || !inputElement.value) {
            dialog.destroy();
            return false;
        }

        fetchPost("/api/asset/renameAsset", {oldPath: assetPath, newName: inputElement.value}, (response) => {
            /// #if MOBILE
            getCurrentEditor()?.reload(false);
            /// #else
            getAllModels().asset.forEach(item => {
                if (item.path === assetPath) {
                    item.path = response.data.newPath;
                    item.parent.updateTitle(getDisplayName(response.data.newPath));
                }
            });
            getAllEditor().forEach(item => {
                item.reload(false);
            });
            /// #endif
            dialog.destroy();
        });
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
