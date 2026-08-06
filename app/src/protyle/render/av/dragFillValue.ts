interface IAVCellValueTarget {
    id: string;
    keyID: string;
    blockID: string;
}

export const rebindAVCellValue = (source: IAVCellValue, target: IAVCellValueTarget) => {
    const value = JSON.parse(JSON.stringify(source)) as IAVCellValue & {
        createdAt?: number;
        updatedAt?: number;
    };
    value.id = target.id;
    value.keyID = target.keyID;
    value.blockID = target.blockID;
    delete value.createdAt;
    delete value.updatedAt;
    return value;
};

export const genAVDragFillValue = rebindAVCellValue;
