import {updateHeader} from "../render/av/row";
import {resetAVRowSelect} from "../render/av/virtualScroll";
import {hasClosestByClassName} from "./hasClosest";
import {Constants} from "../../constants";

export const clearBlockElement = (element: Element, keepRefcount = false) => {
    element.classList.remove("protyle-wysiwyg--select", "protyle-wysiwyg--hl");
    element.removeAttribute(Constants.CUSTOM_RIFF_DECKS);
    if (!keepRefcount) {
        element.removeAttribute("refcount");
        element.querySelector(".protyle-attr--refcount")?.remove();
    }
    element.querySelector(".protyle-attr--av")?.remove();
    element.removeAttribute("custom-avs");
    element.getAttributeNames().forEach(attr => {
        if (attr.startsWith("custom-sy-av-s-text-")) {
            element.removeAttribute(attr);
        }
    });
};

export const clearSelect = (types: ("av" | "img" | "cell" | "row" | "galleryItem")[], element: Element) => {
    if (types.includes("cell")) {
        element.querySelectorAll(".av__cell--select, .av__cell--active").forEach((item: HTMLElement) => {
            item.querySelector(".av__drag-fill")?.remove();
            item.classList.remove("av__cell--select", "av__cell--active");
        });
    }
    if (types.includes("row")) {
        const clearedBodies = new Set<HTMLElement>();
        element.querySelectorAll(".av__row--select").forEach((item: HTMLElement) => {
            item.classList.remove("av__row--select");
            item.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconUncheck");
            const bodyEl = item.parentElement as HTMLElement;
            if (bodyEl && !clearedBodies.has(bodyEl)) {
                // 同步清空虚拟滚动选中快照，确保 updateHeader 计数正确
                resetAVRowSelect(bodyEl, []);
                clearedBodies.add(bodyEl);
            }
            updateHeader(item);
        });
        resetAVBodySelect(element, "table");
    }
    if (types.includes("galleryItem")) {
        const clearedBodies = new Set<HTMLElement>();
        element.querySelectorAll(".av__gallery-item--select").forEach((item: HTMLElement) => {
            clearGalleryItem(item, clearedBodies);
        });
        resetAVBodySelect(element, "gallery");
    }
    if (types.includes("av")) {
        const clearedBodies = new Set<HTMLElement>();
        element.querySelectorAll(" .av__cell--select, .av__cell--active, .av__row--select, .av__gallery-item--select").forEach((item: HTMLElement) => {
            if (item.classList.contains("av__row--select")) {
                item.classList.remove("av__row--select");
                item.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconUncheck");
                const bodyEl = item.parentElement as HTMLElement;
                if (bodyEl && !clearedBodies.has(bodyEl)) {
                    resetAVRowSelect(bodyEl, []);
                    clearedBodies.add(bodyEl);
                }
                updateHeader(item);
            } else if (item.classList.contains("av__gallery-item--select")) {
                clearGalleryItem(item, clearedBodies);
            } else {
                item.querySelector(".av__drag-fill")?.remove();
                item.classList.remove("av__cell--select", "av__cell--active");
            }
        });
        resetAVBodySelect(element, "all");
    }
    if (types.includes("img")) {
        element.querySelectorAll(".img--select").forEach((item: HTMLElement) => {
            item.classList.remove("img--select");
        });
    }

};

const resetAVBodySelect = (element: Element, type: "table" | "gallery" | "all") => {
    const avElements = element.classList.contains("av") ? [element] : Array.from(element.querySelectorAll(".av"));
    avElements.forEach((avElement: HTMLElement) => {
        const avType = avElement.dataset.avType;
        if ((type === "table" && avType !== "table") || (type === "gallery" && avType === "table")) {
            return;
        }
        avElement.querySelectorAll(".av__body").forEach((bodyElement: HTMLElement) => {
            resetAVRowSelect(bodyElement, []);
        });
        const itemElement = avElement.querySelector(
            ".av__row:not(.av__row--header):not(.av__row--footer):not(.av__row--util), .av__gallery-item") as HTMLElement;
        if (itemElement) {
            updateHeader(itemElement);
        }
    });
};

const clearGalleryItem = (item: HTMLElement, clearedBodies: Set<HTMLElement>) => {
    item.classList.remove("av__gallery-item--select");
    const bodyEl = hasClosestByClassName(item, "av__body") as HTMLElement;
    if (bodyEl && !clearedBodies.has(bodyEl)) {
        resetAVRowSelect(bodyEl, []);
        clearedBodies.add(bodyEl);
    }
    updateHeader(item);
};
