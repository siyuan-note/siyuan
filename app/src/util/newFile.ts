import {showMessage} from "../dialog/message";
import {getAllModels} from "../layout/getAll";
import {hasClosestByClassName, hasTopClosestByTag} from "../protyle/util/hasClosest";
import {getDockByType} from "../layout/util";
/// #if !MOBILE
import {Files} from "../layout/dock/Files";
import {openFileById} from "../editor/util";
/// #endif
import {fetchPost} from "./fetch";
import {getDisplayName, getOpenNotebookCount, pathPosix} from "./pathName";
import {Constants} from "../constants";
import {validateName} from "../editor/rename";

export const newFile = (notebookId?: string, currentPath?: string, paths?: string[], useSavePath = false) => {
    if (getOpenNotebookCount() === 0) {
        showMessage(window.siyuan.languages.newFileTip);
        return;
    }
    /// #if !MOBILE
    if (!notebookId) {
        getAllModels().editor.find((item) => {
            const currentElement = item.parent.headElement;
            if (currentElement.classList.contains("item--focus")) {
                notebookId = item.editor.protyle.notebookId;
                if (useSavePath) {
                    currentPath = item.editor.protyle.path;
                } else {
                    currentPath = pathPosix().dirname(item.editor.protyle.path);
                }
                if (hasClosestByClassName(currentElement, "layout__wnd--active")) {
                    return true;
                }
            }
        });
        if (!notebookId) {
            const fileModel = getDockByType("file").data.file;
            if (fileModel instanceof Files) {
                const currentElement = fileModel.element.querySelector(".b3-list-item--focus");
                if (currentElement) {
                    const topElement = hasTopClosestByTag(currentElement, "UL");
                    if (topElement) {
                        notebookId = topElement.getAttribute("data-url");
                    }
                    const selectPath = currentElement.getAttribute("data-path");
                    if (useSavePath) {
                        currentPath = selectPath;
                    } else {
                        currentPath = pathPosix().dirname(selectPath);
                    }
                }
            }
        }
    }
    /// #endif
    if (!notebookId) {
        window.siyuan.notebooks.find(item => {
            if (!item.closed) {
                notebookId = item.id;
                currentPath = "/";
                return true;
            }
        });
    }
    fetchPost("/api/filetree/getDocCreateSavePath", {notebook: notebookId}, (data) => {
        if (data.data.path.indexOf("/") > -1 && useSavePath) {
            if (data.data.path.startsWith("/") || currentPath === "/") {
                fetchPost("/api/filetree/createDocWithMd", {
                    notebook: notebookId,
                    path: data.data.path,
                    markdown: ""
                }, response => {
                    /// #if !MOBILE
                    openFileById({id: response.data, action: [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]});
                    /// #endif
                });
            } else {
                fetchPost("/api/filetree/getHPathByPath", {
                    notebook: notebookId,
                    path: currentPath.endsWith(".sy") ? currentPath : currentPath + ".sy"
                }, (responseHPath) => {
                    fetchPost("/api/filetree/createDocWithMd", {
                        notebook: notebookId,
                        path: pathPosix().join(responseHPath.data, data.data.path),
                        markdown: ""
                    }, response => {
                        /// #if !MOBILE
                        openFileById({id: response.data, action: [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]});
                        /// #endif
                    });
                });
            }
        } else {
            let title = data.data.path || "Untitled"
            title = title.substring(title.lastIndexOf("/") + 1);
            if (!validateName(title)) {
                return;
            }
            const id = Lute.NewNodeID();
            const newPath = pathPosix().join(getDisplayName(currentPath, false, true), id + ".sy");
            if (paths) {
                paths[paths.indexOf(undefined)] = newPath;
            }
            fetchPost("/api/filetree/createDoc", {
                notebook: notebookId,
                path: newPath,
                title,
                md: "",
                sorts: paths
            }, () => {
                /// #if !MOBILE
                openFileById({id, action: [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]});
                /// #endif
            });
        }
    });
};

export const getSavePath = (pathString: string, notebookId: string, cb: (p: string) => void) => {
    fetchPost("/api/filetree/getRefCreateSavePath", {
        notebook: notebookId
    }, (data) => {
        if (data.data.path) {
            if (data.data.path.startsWith("/")) {
                cb(getDisplayName(data.data.path, false, true));
            } else {
                fetchPost("/api/filetree/getHPathByPath", {
                    notebook: notebookId,
                    path: pathString
                }, (response) => {
                    cb(getDisplayName(pathPosix().join(response.data, data.data.path), false, true));
                });
            }
        } else {
            fetchPost("/api/filetree/getHPathByPath", {
                notebook: notebookId,
                path: pathString
            }, (response) => {
                cb(getDisplayName(response.data, false, true));
            });
        }
    });
};
