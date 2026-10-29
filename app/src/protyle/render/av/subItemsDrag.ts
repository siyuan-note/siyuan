import {getAVData} from "./virtualScroll";
import {reparentSubItems} from "./subItems";
import {toggleSubItems} from "./subItemsState";
import {showMessage} from "../../../dialog/message";

export const getSubItemsDrop = (rows: IAVRow[], selectedIDs: string[], targetID: string,
                               position: "before" | "after" | "inside", sorted: boolean) => {
    const target = rows.find(row => row.id === targetID);
    if (!target?.hierarchy || selectedIDs.includes(targetID)) {
        return;
    }
    const parentID = position === "inside" ? targetID : target.hierarchy.parentID || "";
    const byID = new Map(rows.map(row => [row.id, row]));
    let ancestorID = parentID;
    while (ancestorID) {
        if (selectedIDs.includes(ancestorID)) {
            return;
        }
        ancestorID = byID.get(ancestorID)?.hierarchy?.parentID;
    }
    if (sorted && selectedIDs.every(id => (byID.get(id)?.hierarchy?.parentID || "") === parentID)) {
        return;
    }
    // 锚点在内核的完整兄弟列表中定位，不能把当前子项页边界当作整棵树的边界。
    return {parentID,
        previousID: !sorted && position === "after" ? targetID : undefined,
        nextID: !sorted && position === "before" ? targetID : undefined};
};

export const dropSubItems = (protyle: IProtyle, blockElement: HTMLElement, target: HTMLElement,
                            selectedPoints: string[], classNames: string[]) => {
    if (!blockElement.hasAttribute("data-sub-items-nested")) {
        return false;
    }
    const data = getAVData(blockElement);
    const groupID = target.closest<HTMLElement>(".av__body")?.dataset.groupId || "";
    const views = data.view.groups?.length ? data.view.groups : [data.view];
    const rows = (views.find(view => !groupID || view.id === groupID) as IAVTable)?.rows || [];
    const sourceRows = views.flatMap(view => (view as IAVTable).rows || []);
    const ids = [...new Set(selectedPoints.map(point => point.split("@")[0]))];
    const inside = classNames.includes("dragover__bottom--child");
    if (!inside && selectedPoints.some(point => (point.split("@")[1] || "") !== groupID)) {
        // 子项不能通过跨组空白落点隐式改变父项。
        if (ids.some(id => sourceRows.find(row => row.id === id)?.hierarchy?.parentID)) {
            return true;
        }
        // 顶层条目跨组仍沿用原有的分组字段回填事务。
        if (!target.dataset.parentId) {
            return false;
        }
    }
    const result = getSubItemsDrop(rows, ids, target.dataset.id,
        inside ? "inside" : classNames.includes("dragover__bottom") ? "after" : "before", data.view.sorts.length > 0);
    if (result) {
        if (result.parentID) {
            toggleSubItems(blockElement, protyle, groupID, result.parentID, true);
        }
        reparentSubItems(protyle, blockElement, ids, result.parentID, result.previousID, result.nextID, groupID);
    } else if (data.view.sorts.length) {
        showMessage(window.siyuan.languages.avSubItemsSortLocked);
    }
    return true;
};
