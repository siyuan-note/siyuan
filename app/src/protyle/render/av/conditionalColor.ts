import {getAVBackgroundColor} from "./color";

// 按目标条目的前后位置移动规则，未改变顺序时保留原数组。
export const moveConditionalColorRule = (rules: IAVConditionalColorRule[], sourceID: string,
                                         targetID: string, before: boolean) => {
    const sourceIndex = rules.findIndex(rule => rule.id === sourceID);
    const targetIndex = rules.findIndex(rule => rule.id === targetID);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return rules;
    }
    const next = rules.slice();
    const [source] = next.splice(sourceIndex, 1);
    const insertIndex = next.findIndex(rule => rule.id === targetID) + (before ? 0 : 1);
    next.splice(insertIndex, 0, source);
    return next.every((rule, index) => rule === rules[index]) ? rules : next;
};

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
