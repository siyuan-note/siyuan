import {fetchPost} from "../util/fetch";
import {getDisplayName} from "../util/pathName";
import {confirmDialog} from "../dialog/confirmDialog";

export const deleteFile = (notebookId: string, pathString: string, name: string) => {
    if (window.siyuan.config.fileTree.removeDocWithoutConfirm) {
        fetchPost("/api/filetree/removeDoc", {
            notebook: notebookId,
            path: pathString
        });
        return;
    }
    fetchPost("/api/block/getDocInfo", {
        id: getDisplayName(pathString, true, true)
    }, (response) => {
        let tip = `${window.siyuan.languages.confirmDelete} <b>${name}</b>?`;
        if (response.data.subFileCount > 0) {
            tip = `${window.siyuan.languages.confirmDelete} <b>${name}</b> ${window.siyuan.languages.andSubFile.replace("x", response.data.subFileCount)}?`;
        }
        confirmDialog(window.siyuan.languages.delete, tip, () => {
            fetchPost("/api/filetree/removeDoc", {
                notebook: notebookId,
                path: pathString
            });
        });
    });
};
