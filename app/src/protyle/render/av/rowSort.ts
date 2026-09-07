import {confirmDialog} from "../../../dialog/confirmDialog";
import {fetchPost} from "../../../util/fetch";
import {transaction} from "../../wysiwyg/transaction";
import {getAVViewID} from "./filteredTip";
import {waitForPendingTransactions} from "../../util/transactionQueue";

const rowSortRequests = new WeakMap<HTMLElement, object>();

// 同组排序使用完整条目预览，跨组移动继续通过原事务回填分组字段。
export const sortAVRows = async (protyle: IProtyle, blockElement: HTMLElement, selectedIDs: string[],
                           groupID: string, previousID: string, nextID: string,
                           doOperations: IOperation[], undoOperations: IOperation[]) => {
    const request = {};
    rowSortRequests.set(blockElement, request);
    const hasSort = blockElement.querySelector('[data-type="av-sort"]')?.classList.contains("block__icon--active");
    if (!hasSort || selectedIDs.some(item => (item.split("@")[1] || "") !== (groupID || ""))) {
        transaction(protyle, doOperations, undoOperations);
        return;
    }
    const viewID = getAVViewID(blockElement);
    const isCurrent = () => blockElement.isConnected && !protyle.disabled &&
        getAVViewID(blockElement) === viewID && rowSortRequests.get(blockElement) === request;
    await waitForPendingTransactions(protyle);
    if (!isCurrent()) {
        return;
    }
    fetchPost("/api/av/getAttributeViewRowSort", {
        avID: blockElement.dataset.avId,
        blockID: blockElement.dataset.nodeId,
        viewID,
        groupID: groupID || "",
        itemIDs: selectedIDs.map(item => item.split("@")[0]),
        previousID,
        nextID,
    }, response => {
        if (!isCurrent()) {
            return;
        }
        const preview = response.data as {
            conflict: boolean;
            doOperations: IOperation[];
            undoOperations: IOperation[];
        };
        if (!preview.doOperations.length) {
            return;
        }
        const apply = () => {
            if (!isCurrent()) {
                return;
            }
            transaction(protyle, preview.doOperations, preview.undoOperations);
        };
        if (preview.conflict) {
            confirmDialog(window.siyuan.languages.removeSorts, window.siyuan.languages.avDragRemoveSorts, apply);
        } else {
            apply();
        }
    });
};
