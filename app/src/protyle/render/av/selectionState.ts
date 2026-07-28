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
    selectedIDs: string[];
}

interface IAVSelectionState {
    cell?: IAVCellSelection;
    item?: IAVItemSelection;
}

const selectionStates = new WeakMap<HTMLElement, IAVSelectionState>();

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
    getState(blockElement).cell = selection;
};

export const clearAVCellSelectionState = (blockElement: HTMLElement) => {
    const state = selectionStates.get(blockElement);
    if (state) {
        delete state.cell;
    }
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
    state.item = {
        anchorID: itemID,
        anchorGroupID: groupID,
        focusID: itemID,
        focusGroupID: groupID,
        selectedIDs: state.item?.selectedIDs || [],
    };
};

export const setAVItemSelectionState = (blockElement: HTMLElement, selection: IAVItemSelection) => {
    getState(blockElement).item = selection;
};

export const clearAVItemSelectionState = (blockElement: HTMLElement) => {
    const state = selectionStates.get(blockElement);
    if (state) {
        delete state.item;
    }
};

export const refreshAVCellSelection = (blockElement: HTMLElement, data: IAV) => {
    const selection = getAVCellSelection(blockElement);
    if (!selection) {
        return;
    }
    const findView = (view: IAVView): IAVView | undefined => {
        if ((!selection.anchor.groupID && !view.groups?.length) || view.id === selection.anchor.groupID) {
            return view;
        }
        for (const group of view.groups || []) {
            const result = findView(group);
            if (result) {
                return result;
            }
        }
    };
    const view = findView(data.view) as IAVTable;
    if (!view?.rows || !view.columns) {
        clearAVCellSelectionState(blockElement);
        return;
    }
    const columns = view.columns.filter(column => !column.hidden);
    const cells: IAVSelectedCell[] = [];
    selection.cells.forEach(selectedCell => {
        const rowIndex = view.rows.findIndex(row => row.id === selectedCell.rowID);
        const colIndex = columns.findIndex(column => column.id === selectedCell.colID);
        const sourceColIndex = view.columns.findIndex(column => column.id === selectedCell.colID);
        const cell = view.rows[rowIndex]?.cells[sourceColIndex];
        if (cell && colIndex >= 0) {
            cells.push({
                groupID: selection.anchor.groupID,
                rowID: selectedCell.rowID,
                colID: selectedCell.colID,
                rowIndex,
                colIndex,
                cell,
                column: columns[colIndex],
            });
        }
    });
    if (cells.length !== selection.cells.length) {
        clearAVCellSelectionState(blockElement);
        return;
    }
    selection.cells = cells;
};

export const restoreAVCellSelection = (blockElement: HTMLElement) => {
    const selection = getAVCellSelection(blockElement);
    if (!selection) {
        return;
    }
    const selectedKeys = new Set(selection.cells.map(item => `${item.rowID}:${item.colID}`));
    blockElement.querySelectorAll<HTMLElement>(".av__cell--active, .av__cell--select").forEach(item => {
        item.classList.remove("av__cell--active", "av__cell--select");
        item.querySelector(".av__drag-fill")?.remove();
    });
    blockElement.querySelectorAll<HTMLElement>(".av__row[data-id] .av__cell[data-col-id]").forEach(cellElement => {
        const rowElement = cellElement.closest<HTMLElement>(".av__row[data-id]");
        if (!rowElement || !selectedKeys.has(`${rowElement.dataset.id}:${cellElement.dataset.colId}`)) {
            return;
        }
        cellElement.classList.add("av__cell--active");
        if (rowElement.dataset.id === selection.anchor.rowID &&
            cellElement.dataset.colId === selection.anchor.colID) {
            cellElement.classList.add("av__cell--select");
        }
        if (rowElement.dataset.id === selection.focus.rowID &&
            cellElement.dataset.colId === selection.focus.colID &&
            !["template", "rollup", "lineNumber", "created", "updated"].includes(cellElement.dataset.dtype)) {
            cellElement.insertAdjacentHTML("beforeend",
                `<div aria-label="${window.siyuan.languages.dragFill}" class="av__drag-fill ariaLabel"></div>`);
        }
    });
};
