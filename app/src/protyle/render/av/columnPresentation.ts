export const updateAVTableColumnPresentation = (view: IAVTable,
                                              properties: Partial<Pick<IAVColumn, "wrap" | "align">>, columnID?: string) => {
    view.columns.forEach(column => {
        if (columnID === undefined || column.id === columnID) {
            Object.assign(column, properties);
        }
    });
    (view.groups as IAVTable[] || []).forEach(group => updateAVTableColumnPresentation(group, properties, columnID));
};

export const updateAVTableShowIcon = (view: IAVTable, showIcon: boolean) => {
    view.showIcon = showIcon;
    (view.groups as IAVTable[] || []).forEach(group => updateAVTableShowIcon(group, showIcon));
};

export const removeAVTableColumn = (view: IAVTable, columnID: string) => {
    const index = view.columns.findIndex(column => column.id === columnID);
    view.columns = view.columns.filter(column => column.id !== columnID);
    view.rows = view.rows.map(row => ({...row,
        cells: row.cells.filter((cell, cellIndex) => cell.value?.keyID !== columnID && cellIndex !== index),
    }));
    (view.groups as IAVTable[] || []).forEach(group => removeAVTableColumn(group, columnID));
};

export const insertAVTableColumn = (view: IAVTable, column: IAVColumn, previousID: string,
                                    createCell: (rowID: string) => IAVCell) => {
    let index = view.columns.findIndex(item => item.id === column.id);
    const inserted = index < 0;
    if (inserted) {
        index = previousID ? view.columns.findIndex(item => item.id === previousID) + 1 : 0;
        view.columns = [...view.columns.slice(0, index), {...column}, ...view.columns.slice(index)];
    }
    view.rows = view.rows.map(row => !row.cells.some(cell => cell.value?.keyID === column.id) &&
        (inserted || row.cells.length < view.columns.length) ? {...row,
            cells: [...row.cells.slice(0, index), createCell(row.id), ...row.cells.slice(index)],
        } : row);
    (view.groups as IAVTable[] || []).forEach(group => insertAVTableColumn(group, column, previousID, createCell));
};
