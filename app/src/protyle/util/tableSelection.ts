interface ITableSelectionCellInfo {
    row: number;
    col: number;
    rowspan: number;
    colspan: number;
}

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
