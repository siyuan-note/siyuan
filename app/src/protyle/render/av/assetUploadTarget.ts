import type {IAVSelectedCell} from "./selectionState";

export interface IAVAssetUploadTarget {
    stableCell?: IAVSelectedCell;
    cellElement?: HTMLElement;
}

export const getAVAssetUploadTargets = (stableCells: IAVSelectedCell[],
                                        cellElements: HTMLElement[]): IAVAssetUploadTarget[] => {
    if (stableCells.length > 0) {
        return stableCells.map(stableCell => ({stableCell}));
    }
    return cellElements.map(cellElement => ({cellElement}));
};
