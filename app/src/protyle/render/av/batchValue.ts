export type TAVBatchEditMode = "replace" | "add" | "remove";

const decodeCellValue = (value?: string): IAVCellValue | undefined => {
    if (!value) {
        return;
    }
    return JSON.parse(decodeURIComponent(value)) as IAVCellValue;
};

export const getAVBatchEditMode = (cellElement?: HTMLElement): TAVBatchEditMode => {
    return cellElement?.dataset.avBatchMode as TAVBatchEditMode || "replace";
};

export const getAVBatchSourceValue = (cellElement: HTMLElement, fallback: IAVCellValue): IAVCellValue => {
    if (getAVBatchEditMode(cellElement) === "replace") {
        return fallback;
    }
    const value = cellElement.dataset.avBatchChanged === "true" ?
        decodeCellValue(cellElement.dataset.cellValue) :
        decodeCellValue(cellElement.dataset.avBatchOriginalValue);
    return value || fallback;
};

export const getAVBatchDisplayValue = (cellElement: HTMLElement, fallback: IAVCellValue): IAVCellValue => {
    return decodeCellValue(cellElement.dataset.avBatchDisplayValue) || fallback;
};

export const setAVBatchDisplayValue = (cellElements: HTMLElement[], value: IAVCellValue) => {
    const encodedValue = encodeURIComponent(JSON.stringify(value));
    cellElements.forEach(item => {
        item.dataset.avBatchDisplayValue = encodedValue;
    });
};

export const mergeAVBatchRelationValue = (
    original: IAVCellRelationValue,
    previousDisplay: IAVCellRelationValue,
    nextDisplay: IAVCellRelationValue,
    mode: Exclude<TAVBatchEditMode, "replace">
): IAVCellRelationValue => {
    const relations = new Map<string, IAVCellValue>();
    (original.blockIDs || []).forEach((itemID, index) => relations.set(itemID, original.contents[index]));
    if (mode === "add") {
        (nextDisplay.blockIDs || []).forEach((itemID, index) => {
            if (!previousDisplay.blockIDs?.includes(itemID)) {
                relations.set(itemID, nextDisplay.contents[index]);
            }
        });
    } else {
        (previousDisplay.blockIDs || []).forEach(itemID => {
            if (!nextDisplay.blockIDs?.includes(itemID)) {
                relations.delete(itemID);
            }
        });
    }
    return {
        blockIDs: Array.from(relations.keys()),
        contents: Array.from(relations.values())
    };
};
