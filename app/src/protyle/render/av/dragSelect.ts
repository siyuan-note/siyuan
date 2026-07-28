import {resetAVRowSelect} from "./virtualScroll";
import {updateAVSelectionStatus} from "./row";
import {hasClosestByClassName} from "../../util/hasClosest";

const isRectIntersecting = (rect: DOMRect, selectRect: DOMRect) => {
    return rect.height > 0 && rect.width > 0 &&
        rect.top < selectRect.bottom && rect.bottom > selectRect.top &&
        rect.left < selectRect.right && rect.right > selectRect.left;
};

export const isAVDragSelectSupported = (blockElement: HTMLElement) => {
    return blockElement.classList.contains("av") &&
        ["table", "gallery"].includes(blockElement.dataset.avType);
};

export const applyAVDragSelection = (blockElement: HTMLElement, selectRect: DOMRect) => {
    const isTable = blockElement.dataset.avType === "table";
    const itemSelector = isTable ? ".av__row[data-id]" :
        ".av__gallery-item[data-id]:not([data-type=\"ghost\"])";
    const selectedIdsByBody = new Map<HTMLElement, Set<string>>();
    blockElement.querySelectorAll(".av__body").forEach((bodyElement: HTMLElement) => {
        if (hasClosestByClassName(bodyElement, "av") !== blockElement) {
            return;
        }
        selectedIdsByBody.set(bodyElement, new Set());
    });

    blockElement.querySelectorAll(itemSelector).forEach((item: HTMLElement) => {
        if (hasClosestByClassName(item, "av") !== blockElement) {
            return;
        }
        const bodyElement = hasClosestByClassName(item, "av__body") as HTMLElement;
        const selected = isRectIntersecting(item.getBoundingClientRect(), selectRect);
        if (isTable) {
            item.classList.toggle("av__row--select", selected);
            item.querySelector(".av__firstcol use")?.setAttribute("xlink:href", selected ? "#iconCheck" : "#iconUncheck");
        } else {
            item.classList.toggle("av__gallery-item--select", selected);
        }
        if (selected && bodyElement && item.dataset.id) {
            selectedIdsByBody.get(bodyElement)?.add(item.dataset.id);
        }
    });

    selectedIdsByBody.forEach((ids, bodyElement) => {
        resetAVRowSelect(bodyElement, Array.from(ids));
    });
    updateAVSelectionStatus(blockElement);
};

export const clearAVDragSelection = (blockElement: HTMLElement) => {
    const isTable = blockElement.dataset.avType === "table";
    blockElement.querySelectorAll(".av__body").forEach((bodyElement: HTMLElement) => {
        if (hasClosestByClassName(bodyElement, "av") !== blockElement) {
            return;
        }
        resetAVRowSelect(bodyElement, []);
    });
    if (isTable) {
        blockElement.querySelectorAll(".av__row--select").forEach((item: HTMLElement) => {
            if (hasClosestByClassName(item, "av") !== blockElement) {
                return;
            }
            item.classList.remove("av__row--select");
            item.querySelector(".av__firstcol use")?.setAttribute("xlink:href", "#iconUncheck");
        });
    } else {
        blockElement.querySelectorAll(".av__gallery-item--select").forEach(item => {
            if (hasClosestByClassName(item, "av") !== blockElement) {
                return;
            }
            item.classList.remove("av__gallery-item--select");
        });
    }
    updateAVSelectionStatus(blockElement);
};
