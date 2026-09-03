import {updateAVSelectionStatus, updateHeader} from "../render/av/row";
import {resetAVRowSelect} from "../render/av/virtualScroll";
import {hasClosestByClassName} from "./hasClosest";
import {Constants} from "../../constants";
import {clearAVCellSelectionState, clearAVItemSelectionState} from "../render/av/selectionState";
import {BLOCK_SELECTION_MODE_CLASS} from "../wysiwyg/blockSelection";

const getAVElements = (element: Element) => {
    const elements: HTMLElement[] = [];
    if (element.classList.contains("av")) {
        elements.push(element as HTMLElement);
    }
    element.querySelectorAll<HTMLElement>(".av").forEach(item => elements.push(item));
    return elements;
};

const clearViewState = (element: Element) => {
    const attributes = ["data-view-fold-source", "data-view-fold-hidden-source", "data-view-fold",
        "data-view-fold-default", "data-view-fold-hidden", "data-view-heading-owner", "data-view-heading-loaded"];
    const elements = [element, ...Array.from(element.querySelectorAll(attributes.map(attribute => {
        return `[${attribute}]`;
    }).join(", ")))];
    elements.forEach(item => {
        const sourceFold = item.getAttribute("data-view-fold-source");
        if (sourceFold !== null) {
            item.toggleAttribute("fold", sourceFold === "1");
        }
        const sourceHidden = item.getAttribute("data-view-fold-hidden-source");
        if (sourceHidden !== null) {
            item.classList.toggle("fn__none", sourceHidden === "1");
        }
        attributes.forEach(attribute => item.removeAttribute(attribute));
    });
};

export const clearBlockElement = (element: Element, keepRefcount = false) => {
    clearViewState(element);
    element.classList.remove("protyle-wysiwyg--select", BLOCK_SELECTION_MODE_CLASS, "protyle-wysiwyg--hl");
    element.querySelectorAll(`.${BLOCK_SELECTION_MODE_CLASS}`).forEach(item => {
        item.classList.remove(BLOCK_SELECTION_MODE_CLASS);
    });
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
        getAVElements(element).forEach(clearAVCellSelectionState);
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
        getAVElements(element).forEach(clearAVItemSelectionState);
    }
    if (types.includes("galleryItem")) {
        const clearedBodies = new Set<HTMLElement>();
        element.querySelectorAll(".av__gallery-item--select").forEach((item: HTMLElement) => {
            clearGalleryItem(item, clearedBodies);
        });
        resetAVBodySelect(element, "gallery");
        getAVElements(element).forEach(clearAVItemSelectionState);
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
        getAVElements(element).forEach(avElement => {
            clearAVCellSelectionState(avElement);
            clearAVItemSelectionState(avElement);
        });
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
            if (hasClosestByClassName(bodyElement, "av") !== avElement) {
                return;
            }
            resetAVRowSelect(bodyElement, []);
        });
        updateAVSelectionStatus(avElement);
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
