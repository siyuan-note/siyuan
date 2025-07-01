import {updateHeader} from "../render/av/row";

export const clearSelect = (types: ("av" | "img" | "cell" | "row" | "galleryItem")[], element: Element) => {
    if (types.includes("cell")) {
        element.querySelectorAll(".av__cell--select, .av__cell--active").forEach((item: HTMLElement) => {
            item.querySelector(".av__drag-fill")?.remove();
            item.classList.remove("av__cell--select", "av__cell--active");
        });
    }
    if (types.includes("row")) {
        element.querySelectorAll(".av__row--select").forEach((item: HTMLElement) => {
            item.classList.remove("av__row--select");
            item.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconUncheck");
            updateHeader(item);
        });
    }
    if (types.includes("galleryItem")) {
        element.querySelectorAll(".av__gallery-item--select").forEach((item: HTMLElement) => {
            item.classList.remove("av__gallery-item--select");
        });
    }
    if (types.includes("av")) {
        element.querySelectorAll(" .av__cell--select, .av__cell--active, .av__row--select, .av__gallery-item--select").forEach((item: HTMLElement) => {
            if (item.classList.contains("av__row--select")) {
                item.classList.remove("av__row--select");
                item.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconUncheck");
                updateHeader(item);
            } else {
                item.querySelector(".av__drag-fill")?.remove();
                item.classList.remove("av__cell--select", "av__cell--active", "av__gallery-item--select");
            }
        });
    }
    if (types.includes("img")) {
        element.querySelectorAll(".img--select").forEach((item: HTMLElement) => {
            item.classList.remove("img--select");
        });
    }

};
