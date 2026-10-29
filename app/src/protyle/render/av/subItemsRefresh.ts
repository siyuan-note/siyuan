import {Constants} from "../../../constants";
import {getAVData} from "./virtualScroll";
import {getBacklinkScrollElement} from "./backlinkScroll";
import {clearSubItemsViewportAnchor, setSubItemsViewportAnchor} from "./subItemsState";
import {setAVLocateRequest} from "./locate";
import {locateRequests} from "./locateState";

export const prepareSubItemsRefresh = (blockElement: HTMLElement, protyle: IProtyle, operation: IOperation) => {
    if (!blockElement.hasAttribute("data-sub-items") && operation.action !== "setAttrViewSubItems") return;
    const inserted = operation.retData as IInsertAttrViewBlockRetData;
    const insertedItemID = operation.action === "insertAttrViewBlock" && operation.parentID &&
        (!operation.blockID || operation.blockID === blockElement.dataset.nodeId) &&
        (!operation.context?.protyleID || operation.context.protyleID === protyle.id) &&
        inserted?.insertedItemIDs?.length === 1 ? inserted.insertedItemIDs[0] : undefined;
    if (insertedItemID) {
        // 新子项可能落在另一根页或子页，先由内核定位完整树中的位置，再恢复编辑焦点。
        clearSubItemsViewportAnchor(blockElement);
        setAVLocateRequest(blockElement, {itemID: insertedItemID, groupID: operation.groupID,
            select: true, highlight: false});
        blockElement.removeAttribute(Constants.ATTRIBUTE_V_SCROLL);
        return {insertedItemID};
    }
    const config = getAVData(blockElement)?.subItems;
    const relationKeys = config ? [config.parentKeyID, config.childrenKeyID] : [];
    const relationChanged = (operation.action === "updateAttrViewCell" && relationKeys.includes(operation.keyID)) ||
        (operation.action === "updateAttrViewCells" && operation.cellUpdates?.some(cell => relationKeys.includes(cell.keyID)));
    const structureChanged = relationChanged || ["setAttrViewSubItems", "setAttrViewSubItemsDisplay", "reparentAttrViewItems",
        "promoteAttrViewItems", "duplicateAttrViewSubtree", "insertAttrViewBlock", "removeAttrViewBlock"].includes(operation.action);
    const cellChanged = ["updateAttrViewCell", "updateAttrViewCells"].includes(operation.action);
    if ((!structureChanged && !cellChanged) || locateRequests.has(blockElement)) {
        return;
    }
    const scroller = getBacklinkScrollElement(blockElement) || protyle.contentElement;
    const viewport = scroller?.getBoundingClientRect();
    const removedIDs = new Set(operation.action === "removeAttrViewBlock" ? operation.srcIDs : []);
    const candidates = Array.from(blockElement.querySelectorAll<HTMLElement>(".av__row[data-id]"))
        .filter(item => !removedIDs.has(item.dataset.id));
    const row = candidates.find(item => {
        const rect = item.getBoundingClientRect();
        return rect.height > 0 && (!viewport || (rect.bottom > viewport.top && rect.top < viewport.bottom));
    }) || candidates.find(item => item.getBoundingClientRect().height > 0);
    if (structureChanged) blockElement.removeAttribute(Constants.ATTRIBUTE_V_SCROLL);
    if (!row) return;
    const itemID = row.dataset.id;
    const groupID = row.closest<HTMLElement>(".av__body")?.dataset.groupId || "";
    const rect = row.getBoundingClientRect();
    const siblings = candidates.filter(item => (item.closest<HTMLElement>(".av__body")?.dataset.groupId || "") === groupID);
    const rowIndex = siblings.indexOf(row);
    const anchors = [row, ...siblings.slice(rowIndex + 1), ...siblings.slice(0, rowIndex).reverse()]
        .map(item => ({id: item.dataset.id, top: item.getBoundingClientRect().top}));
    setSubItemsViewportAnchor(blockElement, itemID, groupID, rect.height, Number(row.dataset.index), anchors.slice(1).map(item => item.id));
    return {restoreViewport: () => {
        const body = blockElement.querySelector<HTMLElement>(`.av__body[data-group-id="${groupID}"]`);
        if (!body || !scroller || locateRequests.has(blockElement)) return;
        for (const anchor of anchors) {
            const current = body.querySelector<HTMLElement>(`.av__row[data-id="${anchor.id}"]`);
            if (current) {
                scroller.scrollTop += current.getBoundingClientRect().top - anchor.top;
                break;
            }
        }
    }};
};
