const getEstimatedTextWidth = (value: string) => {
    return Array.from(value.trim().replace(/[\r\n]+/g, " ")).reduce((width, character) => {
        if (/[\u2E80-\u9FFF\uAC00-\uD7AF]/u.test(character)) {
            return width + 14;
        }
        if (/\s/u.test(character)) {
            return width + 4;
        }
        if (/[A-ZMW@#%&]/u.test(character)) {
            return width + 9;
        }
        return width + 7;
    }, 0);
};

export const getAVColumnTextMeasurer = (blockElement: HTMLElement) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const cellElement = blockElement.querySelector<HTMLElement>(".av__cell");
    if (!context || !cellElement) {
        return getEstimatedTextWidth;
    }
    const style = getComputedStyle(cellElement);
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return (value: string) => context.measureText(value.trim().replace(/[\r\n]+/g, " ")).width;
};

export const getAVColumnFitWidth = (name: string, type: TAVCol, values: string[],
                                    measureText = getEstimatedTextWidth) => {
    const headerWidth = measureText(name) + 42;
    const contentPadding = ["select", "mSelect"].includes(type) ? 32 : 20;
    const contentWidth = values.reduce((width, value) => Math.max(width, measureText(value) + contentPadding), 0);
    return `${Math.ceil(Math.min(480, Math.max(64, headerWidth, contentWidth)))}px`;
};

export const getAVRelationColumnWidth = (fitWidth: string, type: TAVCol, primary: boolean) => {
    const width = parseFloat(fitWidth) || 64;
    const minWidth = primary ? 120 : 64;
    const maxWidth = ["relation", "rollup", "mAsset"].includes(type) ? 200 : 160;
    return `${Math.min(maxWidth, Math.max(minWidth, width))}px`;
};

export const getAVColumnResizeWidth = (width: number, previousWidth?: number, snapThreshold = 4) => {
    const limitedWidth = Math.max(Math.round(width), 25);
    const normalizedPreviousWidth = typeof previousWidth === "number" ? Math.round(previousWidth) : undefined;
    const snapped = typeof normalizedPreviousWidth === "number" &&
        Math.abs(limitedWidth - normalizedPreviousWidth) <= snapThreshold;
    return {
        width: snapped ? normalizedPreviousWidth : limitedWidth,
        snapped,
    };
};

export const getAVDistributedColumnWidth = (widths: number[]) => {
    if (widths.length === 0) {
        return 25;
    }
    return Math.max(25, Math.round(widths.reduce((total, width) => total + width, 0) / widths.length));
};

export const getAVTableFitWidths = (
    view: IAVTable,
    getValueText: (value: IAVCellValue, column: IAVColumn, rowIndex: number) => string,
    measureText = getEstimatedTextWidth,
    columnIDs?: string[],
) => {
    const targetColumnIDs = columnIDs ? new Set(columnIDs) : undefined;
    const visibleColumns = view.columns.filter(column =>
        !column.hidden && (!targetColumnIDs || targetColumnIDs.has(column.id)));
    const values = new Map(visibleColumns.map(column => [column.id, [] as string[]]));
    const collect = (table: IAVTable) => {
        if (table.groups?.length > 0) {
            (table.groups as IAVTable[]).forEach(group => {
                if (group.groupHidden === 0) {
                    collect(group);
                }
            });
            return;
        }
        visibleColumns.forEach(column => {
            if (column.type === "lineNumber") {
                values.get(column.id)?.push((table.rowCount || table.rows.length).toString());
            }
        });
        const columnIndexes = new Map(visibleColumns.map(column => [
            column.id,
            table.columns.findIndex(item => item.id === column.id),
        ]));
        table.rows.forEach((row, rowIndex) => {
            visibleColumns.forEach(column => {
                if (column.type === "lineNumber") {
                    return;
                }
                const columnIndex = columnIndexes.get(column.id);
                const cell = row.cells.find(item => item.value?.keyID === column.id) ||
                    (typeof columnIndex === "number" && columnIndex > -1 ? row.cells[columnIndex] : undefined);
                if (cell) {
                    values.get(column.id)?.push(getValueText(cell.value, column, rowIndex));
                }
            });
        });
    };
    collect(view);
    return Object.fromEntries(visibleColumns.map(column => [
        column.id,
        getAVColumnFitWidth(column.name, column.type, values.get(column.id) || [], measureText),
    ]));
};
