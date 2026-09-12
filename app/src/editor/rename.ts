import {showMessage} from "../dialog/message";
import {openInputDialog} from "../dialog/inputDialog";
import {focusByRange} from "../protyle/util/selection";
import {hasClosestBlock} from "../protyle/util/hasClosest";
import {removeEmbed} from "../protyle/wysiwyg/removeEmbed";
import {getAssetName, getDisplayName, pathPosix, setNotebookName} from "../util/pathName";
import {fetchPost} from "../util/fetch";
import {Constants} from "../constants";
import {showTooltip} from "../dialog/tooltip";
/// #if !MOBILE
import {getAllModels} from "../layout/getAll";
/// #endif
import {getAllEditor} from "../layout/getAll";

export const validateName = (name: string, targetElement?: HTMLElement) => {
    if (/\r\n|\r|\n|\u2028|\u2029|\t/.test(name)) {
        if (targetElement) {
            showTooltip(window.siyuan.languages.fileNameRule, targetElement, "error");
        } else {
            showMessage(window.siyuan.languages.fileNameRule);
        }
        return false;
    }
    if (name.length > Constants.SIZE_TITLE) {
        if (targetElement) {
            showTooltip(window.siyuan.languages["_kernel"]["106"], targetElement, "error");
        } else {
            showMessage(window.siyuan.languages["_kernel"]["106"]);
        }
        return false;
    }
    return true;
};

export const replaceFileName = (name: string) => {
    if (name.indexOf("/") > -1) {
        showMessage(window.siyuan.languages.fileNameRule);
        name = name.replace(/\//g, "／");
    }
    return name.replace(/\r\n|\r|\n|\u2028|\u2029|\t|/g, "").substring(0, Constants.SIZE_TITLE);
};

export const replaceLocalPath = (name: string) => {
    return name.replace(/\\\\|\/|"|:|\*|\?|\\|'|<|>|\|/g, "");
};

export const rename = (options: {
    path: string
    notebookId: string
    name: string,
    type: "notebook" | "file"
    empty?: boolean
    range?: Range,
}) => {
    if (window.siyuan.config.readonly) {
        return;
    }
    const initialName = options.empty ? "" : options.name;
    const dialog = openInputDialog({
        title: window.siyuan.languages.rename,
        value: initialName,
        destroyCallback() {
            if (options.range) {
                focusByRange(options.range);
            }
        },
        onConfirm: (value, dialog) => {
            if (!validateName(value)) {
                return;
            }
            let name = value.trim();
            if (name === initialName) {
                dialog.destroy();
                return;
            }
            name = replaceFileName(name);
            if (options.type === "notebook") {
                if (!name) {
                    name = window.siyuan.languages.untitled;
                }
                fetchPost("/api/notebook/renameNotebook", {
                    notebook: options.notebookId,
                    name,
                }, () => {
                    setNotebookName(options.notebookId, name);
                });
            } else {
                fetchPost("/api/filetree/renameDoc", {
                    notebook: options.notebookId,
                    path: options.path,
                    title: name,
                });
            }
            dialog.destroy();
        },
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_RENAME);
};

export const renameAsset = (assetPath: string) => {
    const oldName = getAssetName(assetPath);
    const dialog = openInputDialog({
        title: window.siyuan.languages.rename,
        value: oldName,
        onConfirm: (value, dialog) => {
            if (value === oldName || !value) {
                dialog.destroy();
                return;
            }

            fetchPost("/api/asset/renameAsset", {oldPath: assetPath, newName: value}, (response) => {
                /// #if !MOBILE
                getAllModels().asset.forEach(item => {
                    if (item.path === assetPath) {
                        item.update(response.data.newPath);
                    }
                });
                /// #endif
                getAllEditor().forEach(item => {
                    item.reload(false);
                });
                dialog.destroy();
            });
        },
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_RENAMEASSETS);
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
