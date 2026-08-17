export const TABLE_DEFAULT_COLUMN_WIDTH = 60;

export const getDistributedTableColumnWidth = (widths: number[]) => {
    if (widths.length === 0) {
        return TABLE_DEFAULT_COLUMN_WIDTH;
    }
    return Math.max(TABLE_DEFAULT_COLUMN_WIDTH,
        Math.round(widths.reduce((total, width) => total + width, 0) / widths.length));
};

export const isDefaultTableColumnWidth = (width: string, minWidth: string) =>
    !width && minWidth === `${TABLE_DEFAULT_COLUMN_WIDTH}px`;
