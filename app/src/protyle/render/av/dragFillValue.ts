import {createAVLocationReplacement} from "./locationValue";

interface IAVCellValueTarget {
    id: string;
    keyID: string;
    blockID: string;
}

export const rebindAVCellValue = (source: IAVCellValue, target: IAVCellValueTarget) => {
    const value = JSON.parse(JSON.stringify(source,
        (key, item) => key === "renderedContent" ? undefined : item)) as IAVCellValue & {
        createdAt?: number;
        updatedAt?: number;
    };
    value.id = target.id;
    value.keyID = target.keyID;
    value.blockID = target.blockID;
    if (value.type === "location") {
        value.location = createAVLocationReplacement(value.location);
    }
    delete value.createdAt;
    delete value.updatedAt;
    return value;
};

export const genAVDragFillValue = rebindAVCellValue;
