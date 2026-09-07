import {confirmDialog} from "../dialog/confirmDialog";
import {fetchSyncPost} from "./fetch";
import {getRelativeReorderRequest} from "./fileTreeMove";

// 确认前只请求预览，取消或关闭对话框不会移动文档。
export const reorderSortedFileTree = async (sourceIDs: string[], targetID: string, after: boolean):
    Promise<{notebook: string, parentPath: string} | undefined> => {
    const request = {...getRelativeReorderRequest(sourceIDs, targetID, after), respectSort: true};
    const preview = await fetchSyncPost("/api/filetree/reorderDocs", {...request, preview: true});
    if (preview.code !== 0 || !preview.data?.changed) {
        return;
    }
    let removeSorts = false;
    if (preview.data.conflict) {
        removeSorts = await new Promise<boolean>(resolve => {
            confirmDialog(window.siyuan.languages.removeSorts, window.siyuan.languages.fileTreeDragRemoveSorts,
                () => resolve(true), () => resolve(false));
        });
        if (!removeSorts) {
            return;
        }
    }
    const response = await fetchSyncPost("/api/filetree/reorderDocs", {...request, removeSorts});
    if (response.code !== 0) {
        return;
    }
    // 确认期间排序字段可能变化，新的冲突仍需获得确认。
    if (response.data?.conflict && !removeSorts) {
        return reorderSortedFileTree(sourceIDs, targetID, after);
    }
    return response.data;
};
