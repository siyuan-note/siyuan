import {showMessage} from "../dialog/message";
import {getAllModels} from "../layout/getAll";
import {hasTopClosestByTag} from "../protyle/util/hasClosest";
import {getDockByType} from "../layout/util";
/// #if !MOBILE
import {Files} from "../layout/dock/Files";
import {openFileById} from "../editor/util";
/// #endif
import {fetchPost} from "./fetch";
import {getDisplayName, getOpenNotebookCount, pathPosix} from "./pathName";
import {Constants} from "../constants";

export const newFile = (notebookId?: string, currentPath?: string, open?: boolean, paths?: string[]) => {
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
                currentPath = pathPosix().dirname(item.editor.protyle.path);
                if (currentElement.parentElement.parentElement.classList.contains("layout__wnd--active")) {
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
    fetchPost("/api/filetree/getDocNameTemplate", {notebook: notebookId}, (data) => {
        const id = Lute.NewNodeID();
        const newPath = pathPosix().join(getDisplayName(currentPath, false, true), id + ".sy");
        if (paths) {
            paths[paths.indexOf(undefined)] = newPath;
        }
        fetchPost("/api/filetree/createDoc", {
            notebook: notebookId,
            path: newPath,
            title: data.data.name || "Untitled",
            md: "",
            sorts: paths
        }, () => {
            /// #if !MOBILE
            if (open) {
                openFileById({id, hasContext: true, action: [Constants.CB_GET_HL]});
            }
            /// #endif
        });
    });
};

export const getSavePath = (pathString: string, notebookId: string, cb: (p: string) => void) => {
    fetchPost("/api/notebook/getNotebookConf", {
        notebook: notebookId
    }, (data) => {
        let savePath = data.data.conf.refCreateSavePath;
        if (!savePath) {
            savePath = window.siyuan.config.fileTree.refCreateSavePath;
        }
        if (savePath) {
            if (savePath.startsWith("/")) {
                cb(getDisplayName(savePath, false, true));
            } else {
                fetchPost("/api/filetree/getHPathByPath", {
                    notebook: notebookId,
                    path: pathString
                }, (response) => {
                    cb(getDisplayName(pathPosix().join(response.data, savePath), false, true));
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
