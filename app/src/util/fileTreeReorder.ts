import {confirmDialog} from "../dialog/confirmDialog";
import {fetchSyncPost} from "./fetch";
import {getRelativeReorderRequest} from "./fileTreeMove";
import {showMessage} from "../dialog/message";
import {processMessage} from "./processMessage";

const getMoveTarget = async (sourceIDs: string[], targetID: string) => {
    const responses = await Promise.all([targetID, ...sourceIDs].map(id =>
        fetchSyncPost("/api/filetree/getPathByID", {id}, undefined, false)));
    const documents: {notebook: string, path: string}[] = [];
    for (const response of responses) {
        processReorderMessage(response);
        if (response.code !== 0 || !response.data?.path || !response.data?.notebook) {
            return;
        }
        documents.push(response.data);
    }
    const target = documents[0];
    const parentDirectory = target.path.slice(0, target.path.lastIndexOf("/") + 1);
    const parentPath = parentDirectory === "/" ? "/" : parentDirectory.slice(0, -1) + ".sy";
    const fromPaths = documents.slice(1).filter(data => data.notebook !== target.notebook ||
        data.path.slice(0, data.path.lastIndexOf("/") + 1) !== parentDirectory).map(data => data.path);
    return {notebook: target.notebook, parentPath, fromPaths};
};

const processReorderMessage = (response: IWebSocketData) => {
    if (response.code === -1 && response.msg === window.siyuan.languages._kernel[87]) {
        showMessage(response.msg, 7000, "error");
        return;
    }
    processMessage(response);
};

// 确认前只请求预览，取消或关闭对话框不会移动文档。
export const reorderSortedFileTree = async (sourceIDs: string[], targetID: string, after: boolean):
    Promise<{notebook: string, parentPath: string} | undefined> => {
    const request = {...getRelativeReorderRequest(sourceIDs, targetID, after), respectSort: true};
    const preview = await fetchSyncPost("/api/filetree/reorderDocs", {...request, preview: true}, undefined, false);
    processReorderMessage(preview);
    if (preview.code !== 0 || !preview.data?.changed) {
        return;
    }
    let removeSorts = false;
    if (preview.data.conflict) {
        const moveTarget = await getMoveTarget(sourceIDs, targetID);
        if (!moveTarget) {
            return;
        }
        const action = await new Promise<"cancel" | "reorder" | "move">(resolve => {
            const text = window.siyuan.languages.fileTreeDragRemoveSorts + (moveTarget.fromPaths.length > 0 ?
                `<br><br>${window.siyuan.languages.fileTreeMoveKeepSortTip}` : "");
            confirmDialog(window.siyuan.languages.removeSorts, text,
                () => resolve("reorder"), () => resolve("cancel"), false,
                moveTarget.fromPaths.length > 0 ? {
                    label: window.siyuan.languages.fileTreeMoveKeepSort,
                    callback: () => resolve("move"),
                } : undefined);
        });
        if (action === "move") {
            // 对话框打开期间文档可能被移动，执行前重新读取源路径和目标层级。
            const currentTarget = await getMoveTarget(sourceIDs, targetID);
            if (!currentTarget || currentTarget.fromPaths.length === 0) {
                return;
            }
            const response = await fetchSyncPost("/api/filetree/moveDocs", {
                fromPaths: currentTarget.fromPaths,
                toNotebook: currentTarget.notebook,
                toPath: currentTarget.parentPath,
            }, undefined, false);
            processReorderMessage(response);
            if (response.code === 0) {
                return {notebook: currentTarget.notebook, parentPath: currentTarget.parentPath};
            }
            return;
        }
        removeSorts = action === "reorder";
        if (!removeSorts) {
            return;
        }
    }
    const response = await fetchSyncPost("/api/filetree/reorderDocs", {...request, removeSorts}, undefined, false);
    processReorderMessage(response);
    if (response.code !== 0) {
        return;
    }
    // 确认期间排序字段可能变化，新的冲突仍需获得确认。
    if (response.data?.conflict && !removeSorts) {
        return reorderSortedFileTree(sourceIDs, targetID, after);
    }
    if (response.data?.notebook !== undefined && response.data?.parentPath !== undefined) {
        return {notebook: response.data.notebook, parentPath: response.data.parentPath};
    }
};
