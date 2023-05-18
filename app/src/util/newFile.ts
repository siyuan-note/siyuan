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
import {replaceFileName, validateName} from "../editor/rename";
import {hideElements} from "../protyle/ui/hideElements";
import {openMobileFileById} from "../mobile/editor";
import {App} from "../index";

export const getNewFilePath = (useSavePath: boolean) => {
    let notebookId = "";
    let currentPath = "";
    /// #if !MOBILE
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
    return {notebookId, currentPath};
};

export const newFile = (app: App, notebookId?: string, currentPath?: string, paths?: string[], useSavePath = false) => {
    if (getOpenNotebookCount() === 0) {
        showMessage(window.siyuan.languages.newFileTip);
        return;
    }
    if (!notebookId) {
        const resultData = getNewFilePath(useSavePath);
        notebookId = resultData.notebookId;
        currentPath = resultData.currentPath;
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
                    openFileById({app, id: response.data, action: [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]});
                    /// #else
                    openMobileFileById(app, response.data, [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]);
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
                        openFileById({app, id: response.data, action: [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]});
                        /// #else
                        openMobileFileById(app, response.data, [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]);
                        /// #endif
                    });
                });
            }
        } else {
            let title = data.data.path || "Untitled";
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
                openFileById({app, id, action: [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]});
                /// #else
                openMobileFileById(app, id, [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]);
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

export const newFileByName = (app: App, value: string) => {
    const newData = getNewFilePath(true);
    fetchPost("/api/filetree/getHPathByPath", {
        notebook: newData.notebookId,
        path: newData.currentPath,
    }, (responsePath) => {
        fetchPost("/api/filetree/createDocWithMd", {
            notebook: newData.notebookId,
            path: pathPosix().join(responsePath.data, replaceFileName(value.trim()) || "Untitled"),
            markdown: ""
        }, response => {
            hideElements(["dialog"]);
            /// #if MOBILE
            openMobileFileById(app, response.data, [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]);
            /// #else
            openFileById({app, id: response.data, action: [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]});
            /// #endif
        });
    });
};
