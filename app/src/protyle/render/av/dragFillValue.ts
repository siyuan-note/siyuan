interface IAVDragFillTarget {
    id: string;
    keyID: string;
    blockID: string;
}

export const genAVDragFillValue = (source: IAVCellValue, target: IAVDragFillTarget) => {
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
