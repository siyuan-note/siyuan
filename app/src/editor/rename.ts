import {showMessage} from "../dialog/message";
import {mobileInputDialog as openInputDialog} from "../dialog/mobileInputDialog";
import {focusByRange} from "../protyle/util/selectionOffsets";
import {hasClosestBlock} from "../protyle/util/hasClosest";
import {removeEmbed} from "../protyle/wysiwyg/removeEmbed";
import {getAssetName, setNotebookName} from "../util/pathName";
import {documentCreateRequest} from "../util/documentCreate";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {Constants} from "../constants";
import {showTooltip} from "../dialog/tooltip";
/// #if !MOBILE
import {getAllModels} from "../layout/getAll";
/// #endif
import {getAllEditor} from "../layout/getAll";
import {isMobile} from "../util/functions";

export const validateName = (name: string, targetElement?: HTMLElement) => {
    if (/\r\n|\r|\n|\u2028|\u2029|\t/.test(name)) {
        if (targetElement) {
            showTooltip(window.siyuan.languages.fileNameRule, targetElement, "error");
        } else {
            showMessage(window.siyuan.languages.fileNameRule);
        }
        return false;
    }
    const length = Array.from(name).length;
    if (length > Constants.SIZE_TITLE) {
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

// 笔记本名称独立于物理目录，按 Unicode 字符限制长度并保留两种斜杠。
export const normalizeNotebookName = (name: string) => {
    return Array.from(name.replace(/\r\n|\r|\n|\u2028|\u2029|\t/g, "").trim())
        .slice(0, Constants.SIZE_TITLE).join("");
};

export const truncateDocumentTitle = (name: string) => {
    return Array.from(name).slice(0, Constants.SIZE_TITLE).join("");
};

// 文档标题按 Unicode 字符计数，保留字面斜杠。
export const normalizeDocumentTitle = (name: string) => {
    return truncateDocumentTitle(name.replace(/\r\n|\r|\n|\u2028|\u2029|\t/g, ""));
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
    const rootID = options.path?.split("/").pop()?.replace(/\.sy$/, "");
    const notebookDocument = options.type === "notebook" && window.siyuan.config.fileTree?.boxDocEnabled;
    if ((options.type === "file" && rootID) || notebookDocument) {
        void import("../protyle/header/documentTitleDialog").then(({openDocumentTitleDialog}) => {
            openDocumentTitleDialog({id: notebookDocument ? options.notebookId : rootID, notebook: options.notebookId});
        });
        return;
    }
    const initialName = options.empty ? "" : options.name;
    const dialog = openInputDialog({
        title: window.siyuan.languages.rename,
        value: initialName,
        awaitConfirm: true,
        destroyCallback() {
            if (options.range) {
                focusByRange(options.range);
            }
        },
        onConfirm: async (value, dialog) => {
            if (!validateName(value)) {
                return false;
            }
            let name = value.trim();
            if (name === initialName) {
                dialog.destroy();
                return true;
            }
            name = options.type === "notebook" ? normalizeNotebookName(name) : normalizeDocumentTitle(name);
            if (isMobile()) {
                if (options.type === "notebook") {
                    name ||= window.siyuan.languages.untitled;
                    const response = await fetchSyncPost("/api/notebook/renameNotebook", {notebook: options.notebookId, name});
                    if (response.code !== 0) return false;
                    setNotebookName(options.notebookId, name);
                } else {
                    const response = await fetchSyncPost("/api/filetree/renameDoc", {
                        notebook: options.notebookId, path: options.path, title: name,
                    });
                    if (response.code !== 0) return false;
                }
                return true;
            }
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
            return true;
        },
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_RENAME);
};

export const renameAsset = (assetPath: string) => {
    const oldName = getAssetName(assetPath);
    const dialog = openInputDialog({
        title: window.siyuan.languages.rename,
        value: oldName,
        description: window.siyuan.languages.renameAssetTip,
        awaitConfirm: true,
        onConfirm: async (value, dialog) => {
            if (value === oldName || !value) {
                dialog.destroy();
                return true;
            }

            if (await renameAssetFile(assetPath, value)) {
                dialog.destroy();
                return true;
            }
            return false;
        },
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_RENAMEASSETS);
};

export const renameAssetFile = async (assetPath: string, newName: string): Promise<string | undefined> => {
    const response = await fetchSyncPost("/api/asset/renameAsset", {oldPath: assetPath, newName});
    if (response.code !== 0) {
        return;
    }
    /// #if !MOBILE
    getAllModels().asset.forEach(item => {
        if (item.path === assetPath) {
            item.update(response.data.newPath);
        }
    });
    /// #endif
    getAllEditor().forEach(item => item.reload(false));
    return response.data.newPath;
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
    fileNameShort = normalizeDocumentTitle(fileNameShort);
    fetchPost("/api/filetree/createDocByParent", documentCreateRequest(protyle.notebookId, protyle.path,
        Lute.NewNodeID(), fileNameShort, protyle.lute.BlockDOM2StdMd(html)));
};
