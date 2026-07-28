import {hasClosestByClassName} from "../../util/hasClosest";
import {
    getAVData,
    getAVLoadedItemInfos,
    getAVSelectedItemPoints,
    IAVItemInfo,
    resetAVRowSelect,
} from "./virtualScroll";
import {updateAVSelectionStatus} from "./row";
import {
    clearAVCellSelectionState,
    clearAVItemSelectionState,
    findAVItemPointIndex,
    getAVCellSelection,
    getAVItemSelection,
    IAVCellPoint,
    IAVSelectedCell,
    restoreAVCellSelection,
    setAVCellSelection,
    setAVItemAnchorState,
    setAVItemSelectionState,
} from "./selectionState";

const getGroupID = (element: Element) => {
    return (hasClosestByClassName(element, "av__body") as HTMLElement)?.dataset.groupId || "";
};

const getGroupView = (view: IAVView, groupID: string): IAVView | undefined => {
    if (!groupID) {
        return view.groups?.length > 0 ? undefined : view;
    }
    if (view.id === groupID) {
        return view;
    }
    for (const group of view.groups || []) {
        const result = getGroupView(group, groupID);
        if (result) {
            return result;
        }
    }
};

const getCellPoint = (cellElement: HTMLElement): IAVCellPoint | undefined => {
    const rowElement = hasClosestByClassName(cellElement, "av__row") as HTMLElement;
    if (!rowElement?.dataset.id || !cellElement.dataset.colId) {
        return;
    }
    return {
        groupID: getGroupID(rowElement),
        rowID: rowElement.dataset.id,
        colID: cellElement.dataset.colId,
    };
};

const buildCellSelection = (blockElement: HTMLElement, anchor: IAVCellPoint,
                            focus: IAVCellPoint): IAVSelectedCell[] => {
    if (anchor.groupID !== focus.groupID) {
        return [];
    }
    const data = getAVData(blockElement);
    const view = data && getGroupView(data.view, anchor.groupID) as IAVTable;
    if (!view?.rows || !view.columns) {
        return [];
    }
    const visibleColumns = view.columns.filter(column => !column.hidden);
    const anchorRowIndex = view.rows.findIndex(row => row.id === anchor.rowID);
    const focusRowIndex = view.rows.findIndex(row => row.id === focus.rowID);
    const anchorColIndex = visibleColumns.findIndex(column => column.id === anchor.colID);
    const focusColIndex = visibleColumns.findIndex(column => column.id === focus.colID);
    if ([anchorRowIndex, focusRowIndex, anchorColIndex, focusColIndex].some(index => index < 0)) {
        return [];
    }
    const rowStart = Math.min(anchorRowIndex, focusRowIndex);
    const rowEnd = Math.max(anchorRowIndex, focusRowIndex);
    const colStart = Math.min(anchorColIndex, focusColIndex);
    const colEnd = Math.max(anchorColIndex, focusColIndex);
    const sourceColIndexes = new Map(view.columns.map((column, index) => [column.id, index]));
    const selectedCells: IAVSelectedCell[] = [];
    for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex++) {
        const row = view.rows[rowIndex];
        for (let colIndex = colStart; colIndex <= colEnd; colIndex++) {
            const column = visibleColumns[colIndex];
            const sourceColIndex = sourceColIndexes.get(column.id);
            if (typeof sourceColIndex !== "number") {
                continue;
            }
            const cell = row.cells[sourceColIndex];
            if (cell) {
                selectedCells.push({
                    groupID: anchor.groupID,
                    rowID: row.id,
                    colID: column.id,
                    rowIndex,
                    colIndex,
                    cell,
                    column,
                });
            }
        }
    }
    return selectedCells;
};

const clearCellDOM = (blockElement: HTMLElement) => {
    blockElement.querySelectorAll<HTMLElement>(".av__cell--active, .av__cell--select").forEach(item => {
        item.classList.remove("av__cell--active", "av__cell--select");
        item.querySelector(".av__drag-fill")?.remove();
    });
};

export const clearAVCellRange = (blockElement: HTMLElement) => {
    clearCellDOM(blockElement);
    clearAVCellSelectionState(blockElement);
};

const applyCellRange = (blockElement: HTMLElement, anchor: IAVCellPoint, focus: IAVCellPoint) => {
    const cells = buildCellSelection(blockElement, anchor, focus);
    if (cells.length === 0) {
        return false;
    }
    clearAVItemSelection(blockElement, true);
    setAVCellSelection(blockElement, {anchor, focus, cells});
    restoreAVCellSelection(blockElement);
    return true;
};

export const setAVCellAnchor = (blockElement: HTMLElement, cellElement: HTMLElement) => {
    const point = getCellPoint(cellElement);
    if (!point) {
        return false;
    }
    return applyCellRange(blockElement, point, point);
};

export const selectAVCellRange = (blockElement: HTMLElement, cellElement: HTMLElement) => {
    const focus = getCellPoint(cellElement);
    if (!focus) {
        return false;
    }
    const anchor = getAVCellSelection(blockElement)?.anchor;
    if (!anchor || anchor.groupID !== focus.groupID) {
        return applyCellRange(blockElement, focus, focus);
    }
    return applyCellRange(blockElement, anchor, focus);
};

const getRenderedCell = (blockElement: HTMLElement, point: IAVCellPoint) => {
    const groupSelector = point.groupID ? `[data-group-id="${point.groupID}"]` : "";
    return blockElement.querySelector<HTMLElement>(
        `.av__body${groupSelector} .av__row[data-id="${point.rowID}"] .av__cell[data-col-id="${point.colID}"]`);
};

export const moveAVCellRange = (blockElement: HTMLElement, direction: "up" | "down" | "left" | "right") => {
    const selection = getAVCellSelection(blockElement);
    if (!selection) {
        return;
    }
    const data = getAVData(blockElement);
    const view = data && getGroupView(data.view, selection.focus.groupID) as IAVTable;
    if (!view?.rows || !view.columns) {
        return;
    }
    const columns = view.columns.filter(column => !column.hidden);
    let rowIndex = view.rows.findIndex(row => row.id === selection.focus.rowID);
    let colIndex = columns.findIndex(column => column.id === selection.focus.colID);
    if (rowIndex < 0 || colIndex < 0) {
        return;
    }
    if (direction === "up") {
        rowIndex--;
    } else if (direction === "down") {
        rowIndex++;
    } else if (direction === "left") {
        colIndex--;
    } else {
        colIndex++;
    }
    if (!view.rows[rowIndex] || !columns[colIndex]) {
        return;
    }
    const focus = {
        groupID: selection.focus.groupID,
        rowID: view.rows[rowIndex].id,
        colID: columns[colIndex].id,
    };
    if (!applyCellRange(blockElement, selection.anchor, focus)) {
        return;
    }
    return getRenderedCell(blockElement, focus);
};

const getItemElement = (blockElement: HTMLElement, item: Pick<IAVItemInfo, "itemID" | "groupID">) => {
    const groupSelector = item.groupID ? `[data-group-id="${item.groupID}"]` : "";
    return blockElement.querySelector<HTMLElement>(
        `.av__body${groupSelector} .av__row[data-id="${item.itemID}"], ` +
        `.av__body${groupSelector} .av__gallery-item[data-id="${item.itemID}"]`);
};

const getItemKey = (groupID: string, itemID: string) => `${groupID}:${itemID}`;

const syncItemSelectionDOM = (blockElement: HTMLElement, selectedKeys: Set<string>) => {
    const isTable = blockElement.dataset.avType === "table";
    blockElement.querySelectorAll<HTMLElement>(".av__row[data-id], .av__gallery-item[data-id]").forEach(item => {
        if (item.closest(".av") !== blockElement) {
            return;
        }
        const groupID = item.closest<HTMLElement>(".av__body")?.dataset.groupId || "";
        const selected = selectedKeys.has(getItemKey(groupID, item.dataset.id));
        item.classList.toggle(isTable ? "av__row--select" : "av__gallery-item--select", selected);
        if (isTable) {
            item.querySelector(".av__firstcol use")?.setAttribute("xlink:href",
                selected ? "#iconCheck" : "#iconUncheck");
        }
    });
};

export const clearAVItemSelection = (blockElement: HTMLElement, clearAnchor = false) => {
    blockElement.querySelectorAll<HTMLElement>(".av__body").forEach(bodyElement => {
        if (bodyElement.closest(".av") === blockElement) {
            resetAVRowSelect(bodyElement, []);
        }
    });
    syncItemSelectionDOM(blockElement, new Set());
    updateAVSelectionStatus(blockElement);
    if (clearAnchor) {
        clearAVItemSelectionState(blockElement);
    }
};

export const setAVItemAnchor = (blockElement: HTMLElement, itemElement: HTMLElement) => {
    if (!itemElement?.dataset.id) {
        return;
    }
    const groupID = getGroupID(itemElement);
    setAVItemSelectionState(blockElement, {
        anchorID: itemElement.dataset.id,
        anchorGroupID: groupID,
        focusID: itemElement.dataset.id,
        focusGroupID: groupID,
    });
};

const applyItemRange = (blockElement: HTMLElement, target: IAVItemInfo) => {
    const viewType = blockElement.dataset.avType as TAVView;
    const allItems = getAVLoadedItemInfos(blockElement, true);
    const scopeItems = viewType === "kanban" ?
        allItems.filter(item => item.groupID === target.groupID) : allItems;
    let itemSelection = getAVItemSelection(blockElement);
    let anchorIndex = findAVItemPointIndex(
        scopeItems, itemSelection?.anchorID, itemSelection?.anchorGroupID);
    const targetIndex = findAVItemPointIndex(scopeItems, target.itemID, target.groupID);
    if (targetIndex < 0) {
        return false;
    }
    if (anchorIndex < 0) {
        setAVItemAnchorState(blockElement, target.itemID, target.groupID);
        itemSelection = getAVItemSelection(blockElement);
        anchorIndex = targetIndex;
    }
    const selectedItems = scopeItems.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1);
    const selectedKeys = new Set(selectedItems.map(item => getItemKey(item.groupID, item.itemID)));
    blockElement.querySelectorAll<HTMLElement>(".av__body").forEach(bodyElement => {
        if (bodyElement.closest(".av") !== blockElement) {
            return;
        }
        const groupID = bodyElement.dataset.groupId || "";
        resetAVRowSelect(bodyElement, selectedItems.filter(item => item.groupID === groupID).map(item => item.itemID));
    });
    clearAVCellRange(blockElement);
    syncItemSelectionDOM(blockElement, selectedKeys);
    updateAVSelectionStatus(blockElement);
    setAVItemSelectionState(blockElement, {
        anchorID: itemSelection.anchorID,
        anchorGroupID: itemSelection.anchorGroupID,
        focusID: target.itemID,
        focusGroupID: target.groupID,
    });
    return true;
};

export const selectAVItemRange = (blockElement: HTMLElement, itemElement: HTMLElement) => {
    if (!itemElement?.dataset.id) {
        return false;
    }
    const groupID = getGroupID(itemElement);
    const target = getAVLoadedItemInfos(blockElement, true).find(item =>
        item.itemID === itemElement.dataset.id && item.groupID === groupID);
    return target ? applyItemRange(blockElement, target) : false;
};

export const moveAVItemRange = (blockElement: HTMLElement, direction: "up" | "down") => {
    const selection = getAVItemSelection(blockElement);
    if (!selection) {
        return;
    }
    const viewType = blockElement.dataset.avType as TAVView;
    const allItems = getAVLoadedItemInfos(blockElement, true);
    const scopeItems = viewType === "kanban" ?
        allItems.filter(item => item.groupID === selection.focusGroupID) : allItems;
    const focusIndex = findAVItemPointIndex(scopeItems, selection.focusID, selection.focusGroupID);
    if (focusIndex < 0) {
        return;
    }
    const target = scopeItems[focusIndex + (direction === "up" ? -1 : 1)];
    if (!target || !applyItemRange(blockElement, target)) {
        return;
    }
    return getItemElement(blockElement, target);
};

export const setAVDragItemAnchor = (blockElement: HTMLElement) => {
    const selectedKeys = new Set(getAVSelectedItemPoints(blockElement).map(item =>
        getItemKey(item.groupID, item.itemID)));
    const selectedItems = getAVLoadedItemInfos(blockElement, true).filter(item =>
        selectedKeys.has(getItemKey(item.groupID, item.itemID)));
    if (selectedItems.length > 0) {
        const firstSelected = selectedItems[0];
        const lastSelected = selectedItems[selectedItems.length - 1];
        setAVItemSelectionState(blockElement, {
            anchorID: firstSelected.itemID,
            anchorGroupID: firstSelected.groupID,
            focusID: lastSelected.itemID,
            focusGroupID: lastSelected.groupID,
        });
    } else {
        clearAVItemSelectionState(blockElement);
    }
};
