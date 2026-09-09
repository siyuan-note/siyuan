export interface IAVCellPoint {
    groupID: string;
    rowID: string;
    colID: string;
}

export interface IAVSelectedCell {
    groupID: string;
    rowID: string;
    colID: string;
    rowIndex: number;
    colIndex: number;
    cell: IAVCell;
    column: IAVColumn;
}

interface IAVCellSelection {
    anchor: IAVCellPoint;
    focus: IAVCellPoint;
    cells: IAVSelectedCell[];
}

interface IAVItemSelection {
    anchorID: string;
    anchorGroupID: string;
    focusID: string;
    focusGroupID: string;
}

interface IAVSelectionState {
    cell?: IAVCellSelection;
    item?: IAVItemSelection;
}

const selectionStates = new WeakMap<HTMLElement, IAVSelectionState>();

export const getAVSelectionRoot = (element?: Element | null) =>
    element?.closest<HTMLElement>("[data-av-id][data-av-type]") || undefined;

export const findAVItemPointIndex = <T extends {itemID: string, groupID: string}>(
    items: T[], itemID?: string, groupID?: string) => {
    return items.findIndex(item => item.itemID === itemID && item.groupID === groupID);
};

export const reconcileAVSelectedItemIDs = (availableItemIDs: Iterable<string>,
                                            selectedItemIDs: Iterable<string>) => {
    const availableIDs = new Set(availableItemIDs);
    return new Set(Array.from(selectedItemIDs).filter(itemID => availableIDs.has(itemID)));
};

const getState = (blockElement: HTMLElement) => {
    let state = selectionStates.get(blockElement);
    if (!state) {
        state = {};
        selectionStates.set(blockElement, state);
    }
    return state;
};

export const getAVCellSelection = (blockElement: HTMLElement) => {
    return selectionStates.get(blockElement)?.cell;
};

export const setAVCellSelection = (blockElement: HTMLElement, selection: IAVCellSelection) => {
    const state = getState(blockElement);
    state.cell = selection;
    delete state.item;
};

export const clearAVCellSelectionState = (blockElement: HTMLElement) => {
    const state = selectionStates.get(blockElement);
    if (state) {
        delete state.cell;
    }
};

export const collapseAVCellSelectionToAnchor = (blockElement: HTMLElement) => {
    const selection = getAVCellSelection(blockElement);
    if (!selection) {
        return;
    }
    const anchorCell = selection.cells.find(item =>
        item.groupID === selection.anchor.groupID &&
        item.rowID === selection.anchor.rowID &&
        item.colID === selection.anchor.colID);
    if (!anchorCell) {
        clearAVCellSelectionState(blockElement);
        return;
    }
    selection.focus = {...selection.anchor};
    selection.cells = [anchorCell];
};

export const getAVSelectedCells = (blockElement: HTMLElement) => {
    return selectionStates.get(blockElement)?.cell?.cells || [];
};

export const updateAVSelectedCellValue = (blockElement: HTMLElement, rowID: string, colID: string,
                                          value: IAVCellValue) => {
    const selectedCell = getAVSelectedCells(blockElement).find(item =>
        item.rowID === rowID && item.colID === colID);
    if (selectedCell) {
        selectedCell.cell.id = value.id || "";
        selectedCell.cell.value = value;
        selectedCell.cell.valueType = value.type;
    }
};

export const getAVItemSelection = (blockElement: HTMLElement) => {
    return selectionStates.get(blockElement)?.item;
};

export const setAVItemAnchorState = (blockElement: HTMLElement, itemID: string, groupID: string) => {
    const state = getState(blockElement);
    delete state.cell;
    state.item = {
        anchorID: itemID,
        anchorGroupID: groupID,
        focusID: itemID,
        focusGroupID: groupID,
    };
};

export const setAVItemSelectionState = (blockElement: HTMLElement, selection: IAVItemSelection) => {
    const state = getState(blockElement);
    state.item = selection;
    delete state.cell;
};

export const clearAVItemSelectionState = (blockElement: HTMLElement) => {
    const state = selectionStates.get(blockElement);
    if (state) {
        delete state.item;
    }
};

const findAVSelectionView = (view: IAVView, groupID: string): IAVView | undefined => {
    if ((!groupID && !view.groups?.length) || view.id === groupID) {
        return view;
    }
    for (const group of view.groups || []) {
        const result = findAVSelectionView(group, groupID);
        if (result) {
            return result;
        }
    }
};

export const resolveAVSelectedCell = (data: IAV, point: IAVCellPoint): IAVSelectedCell | undefined => {
    const view = findAVSelectionView(data.view, point.groupID);
    if (!view) {
        return;
    }
    const sourceColumns = (view as IAVTable).columns || (view as IAVGallery).fields || [];
    const rows: Array<IAVRow | IAVGalleryItem> = (view as IAVTable).rows || (view as IAVGallery).cards || [];
    const columns = sourceColumns.filter(column => !column.hidden);
    const rowIndex = rows.findIndex(row => row.id === point.rowID);
    const colIndex = columns.findIndex(column => column.id === point.colID);
    const sourceColIndex = sourceColumns.findIndex(column => column.id === point.colID);
    const row = rows[rowIndex];
    const cell = row && ("cells" in row ? row.cells : row.values)[sourceColIndex];
    if (!cell || colIndex < 0) {
        return;
    }
    return {
        groupID: point.groupID,
        rowID: point.rowID,
        colID: point.colID,
        rowIndex,
        colIndex,
        cell,
        column: columns[colIndex],
    };
};

export const refreshAVCellSelection = (blockElement: HTMLElement, data: IAV) => {
    const selection = getAVCellSelection(blockElement);
    if (!selection) {
        return true;
    }
    const cells = selection.cells.map(selectedCell => resolveAVSelectedCell(data, selectedCell)).
        filter((cell): cell is IAVSelectedCell => Boolean(cell));
    if (cells.length !== selection.cells.length) {
        clearAVCellSelectionState(blockElement);
        return false;
    }
    selection.cells = cells;
    return true;
};

export const restoreAVCellSelection = (blockElement: HTMLElement) => {
    const selection = getAVCellSelection(blockElement);
    if (!selection) {
        return;
    }
    const selectedKeys = new Set(selection.cells.map(item => `${item.groupID}:${item.rowID}:${item.colID}`));
    blockElement.querySelectorAll<HTMLElement>(".av__cell--active, .av__cell--select").forEach(item => {
        item.classList.remove("av__cell--active", "av__cell--select");
        item.querySelector(".av__drag-fill")?.remove();
    });
    blockElement.querySelectorAll<HTMLElement>(".av__row[data-id] .av__cell[data-col-id]").forEach(cellElement => {
        const rowElement = cellElement.closest<HTMLElement>(".av__row[data-id]");
        const groupID = cellElement.closest<HTMLElement>(".av__body")?.dataset.groupId || "";
        if (!rowElement || !selectedKeys.has(`${groupID}:${rowElement.dataset.id}:${cellElement.dataset.colId}`)) {
            return;
        }
        cellElement.classList.add("av__cell--active");
        if (groupID === selection.anchor.groupID && rowElement.dataset.id === selection.anchor.rowID &&
            cellElement.dataset.colId === selection.anchor.colID) {
            cellElement.classList.add("av__cell--select");
        }
        if (groupID === selection.focus.groupID && rowElement.dataset.id === selection.focus.rowID &&
            cellElement.dataset.colId === selection.focus.colID &&
            !["template", "rollup", "lineNumber", "created", "updated"].includes(cellElement.dataset.dtype)) {
            cellElement.insertAdjacentHTML("beforeend",
                `<div aria-label="${window.siyuan.languages.dragFill}" class="av__drag-fill ariaLabel"></div>`);
        }
    });
};
