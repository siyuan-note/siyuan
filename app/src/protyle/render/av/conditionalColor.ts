import {getAVBackgroundColor} from "./color";

export const getConditionalBackground = (color: IAVCellSelectValue) =>
    color ? (color.color ? getAVBackgroundColor(color) : "var(--b3-theme-background)") : "";

export const getConditionalItemStyle = (row: IAVRow | IAVGalleryItem) => {
    const background = getConditionalBackground(row.conditionalColors?.background);
    return background ? `--b3-av-item-background:${background};--b3-av-item-opacity:1;` : "";
};

export const getConditionalCellStyle = (row: IAVRow, fieldID: string) => {
    const color = row.conditionalColors?.properties?.[fieldID];
    return color ? `--b3-av-cell-background:${getConditionalBackground(color)};` : "";
};
