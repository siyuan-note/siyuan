import {escapeHtml} from "../../util/escape";

export const getImageTooltip = (image: HTMLImageElement) => {
    return Array.from(new Set([image.title, image.alt].filter(Boolean))).map(text => escapeHtml(text)).join("<br>");
};
