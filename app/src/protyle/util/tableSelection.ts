export interface ITableSelectionCellInfo {
    row: number;
    col: number;
    rowspan: number;
    colspan: number;
}

export interface IProjectedTableCell<T extends ITableSelectionCellInfo> {
    source: T;
    row: number;
    col: number;
    rowspan: number;
    colspan: number;
}

export const transposeTableCells = <T extends ITableSelectionCellInfo>(
    cellInfos: T[],
    rowCount: number,
    columnCount: number,
) => {
    const cells: IProjectedTableCell<T>[] = [];
    cellInfos.forEach(info => {
        if (info.row < 0 || info.row >= rowCount || info.col < 0 || info.col >= columnCount) {
            return;
        }
        const rowspan = Math.max(1, Math.min(info.rowspan, rowCount - info.row));
        const colspan = Math.max(1, Math.min(info.colspan, columnCount - info.col));
        cells.push({
            source: info,
            row: info.col,
            col: info.row,
            rowspan: colspan,
            colspan: rowspan,
        });
    });
    cells.sort((a, b) => a.row - b.row || a.col - b.col);
    return {
        cells,
        rowCount: columnCount,
        columnCount: rowCount,
    };
};

export const getTableHeadRowCount = <T extends ITableSelectionCellInfo>(
    cells: T[],
    rowCount: number,
    minimum = 1,
) => {
    if (rowCount === 0) {
        return 0;
    }
    let headRowCount = Math.min(rowCount, Math.max(1, minimum));
    let previousHeadRowCount = 0;
    while (headRowCount !== previousHeadRowCount) {
        previousHeadRowCount = headRowCount;
        cells.forEach(cell => {
            if (cell.row < headRowCount) {
                headRowCount = Math.max(headRowCount, cell.row + cell.rowspan);
            }
        });
        headRowCount = Math.min(headRowCount, rowCount);
    }
    return headRowCount;
};

export const projectTableCells = <T extends ITableSelectionCellInfo>(
    cellInfos: T[],
    retainedRows: number[],
    retainedColumns: number[],
) => {
    const rows = Array.from(new Set(retainedRows)).sort((a, b) => a - b);
    const columns = Array.from(new Set(retainedColumns)).sort((a, b) => a - b);
    const rowMap = new Map(rows.map((row, index) => [row, index]));
    const columnMap = new Map(columns.map((column, index) => [column, index]));
    const cells: IProjectedTableCell<T>[] = [];
    cellInfos.forEach(info => {
        const cellRows = rows.filter(row => row >= info.row && row < info.row + info.rowspan);
        const cellColumns = columns.filter(column => column >= info.col && column < info.col + info.colspan);
        if (cellRows.length === 0 || cellColumns.length === 0) {
            return;
        }
        const row = rowMap.get(cellRows[0]);
        const col = columnMap.get(cellColumns[0]);
        if (row === undefined || col === undefined) {
            return;
        }
        cells.push({
            source: info,
            row,
            col,
            rowspan: cellRows.length,
            colspan: cellColumns.length,
        });
    });
    cells.sort((a, b) => a.row - b.row || a.col - b.col);
    return {rows, columns, cells};
};

export const getProjectedTableHeadRowCount = <T extends ITableSelectionCellInfo>(
    cells: IProjectedTableCell<T>[],
    retainedRows: number[],
    sectionOfRow: string[],
) => {
    if (retainedRows.length === 0) {
        return 0;
    }
    return getTableHeadRowCount(cells, retainedRows.length,
        retainedRows.filter(row => sectionOfRow[row] === "thead").length);
};

export const getTableDragEdge = (targetCenter: number, minCenter: number, maxCenter: number) => {
    if (minCenter > maxCenter) {
        return;
    }
    if (targetCenter <= minCenter) {
        return "start" as const;
    }
    if (targetCenter >= maxCenter) {
        return "end" as const;
    }
};

export const getTableCellsInRectangle = <T extends ITableSelectionCellInfo>(cellInfos: T[], start?: T, end?: T) => {
    if (!start || !end) {
        return [];
    }
    let rowStart = Math.min(start.row, end.row);
    let rowEnd = Math.max(start.row + start.rowspan - 1, end.row + end.rowspan - 1);
    let colStart = Math.min(start.col, end.col);
    let colEnd = Math.max(start.col + start.colspan - 1, end.col + end.colspan - 1);
    let changed = true;
    while (changed) {
        changed = false;
        cellInfos.forEach(info => {
            if (info.row <= rowEnd && info.row + info.rowspan - 1 >= rowStart &&
                info.col <= colEnd && info.col + info.colspan - 1 >= colStart) {
                const nextRowStart = Math.min(rowStart, info.row);
                const nextRowEnd = Math.max(rowEnd, info.row + info.rowspan - 1);
                const nextColStart = Math.min(colStart, info.col);
                const nextColEnd = Math.max(colEnd, info.col + info.colspan - 1);
                changed = nextRowStart !== rowStart || nextRowEnd !== rowEnd ||
                    nextColStart !== colStart || nextColEnd !== colEnd;
                rowStart = nextRowStart;
                rowEnd = nextRowEnd;
                colStart = nextColStart;
                colEnd = nextColEnd;
            }
        });
    }
    return cellInfos.filter(info => info.row <= rowEnd && info.row + info.rowspan - 1 >= rowStart &&
        info.col <= colEnd && info.col + info.colspan - 1 >= colStart);
};
