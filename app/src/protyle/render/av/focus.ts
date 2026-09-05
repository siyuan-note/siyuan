import {addDragFill, cellScrollIntoView} from "./cell";
import {clearSelect} from "../../util/clear";
import {focusBlock, focusByRange} from "../../util/selection";
import {getFirstBlock, getLastBlock, getNextBlock, getPreviousBlock} from "../../wysiwyg/getBlock";
import {scrollCenter} from "../../../util/highlightById";
import {focusEditableAtGoalX, TVerticalDirection} from "../../wysiwyg/verticalCaret";
import {selectAVItemRange, setAVItemAnchor} from "./rangeSelect";

const isForwardArrow = (key: string) => key === "ArrowDown" || key === "ArrowRight";

const getVisibleAVTitle = (blockElement: HTMLElement) => {
    const titleElement = Array.from(blockElement.querySelectorAll<HTMLElement>(".av__title:not(.fn__none)")).find(item =>
        item.closest(".av") === blockElement
    );
    return titleElement?.getClientRects().length > 0 ? titleElement : undefined;
};

const getOwnVisibleElements = (blockElement: HTMLElement, selector: string) =>
    Array.from(blockElement.querySelectorAll<HTMLElement>(selector)).filter(item =>
        item.closest(".av") === blockElement && item.getClientRects().length > 0
    );

const getClosestCell = (rowElement: HTMLElement, goalX: number) => {
    const cells = Array.from(rowElement.querySelectorAll<HTMLElement>(".av__cell")).filter(item =>
        item.getClientRects().length > 0
    );
    return cells.reduce((closest, item) => {
        const rect = item.getBoundingClientRect();
        const distance = goalX < rect.left ? rect.left - goalX : goalX > rect.right ? goalX - rect.right : 0;
        return !closest || distance < closest.distance ? {element: item, distance} : closest;
    }, undefined as { element: HTMLElement, distance: number } | undefined)?.element;
};

export const getAVVerticalGoalX = (blockElement: HTMLElement) => {
    const selectedElement = Array.from(blockElement.querySelectorAll<HTMLElement>(
        ".av__cell--select, .av__cell--active, .av__row--select, .av__gallery-item--select")).find(item =>
        item.closest(".av") === blockElement
    );
    if (!selectedElement) {
        return;
    }
    const rect = selectedElement.getBoundingClientRect();
    return rect.left + rect.width / 2;
};

export const focusAVTitleByVerticalArrow = (blockElement: HTMLElement, direction: TVerticalDirection,
                                            goalX: number) => {
    const titleElement = getVisibleAVTitle(blockElement);
    if (!titleElement) {
        return false;
    }
    clearSelect(["av"], blockElement);
    return focusEditableAtGoalX(titleElement, direction, goalX);
};

export const focusAVVerticalRegion = (blockElement: HTMLElement, direction: TVerticalDirection, goalX: number,
                                      includeTitle = true) => {
    const titleElement = includeTitle && getVisibleAVTitle(blockElement);
    if (direction === "down" && titleElement) {
        clearSelect(["av"], blockElement);
        return focusEditableAtGoalX(titleElement, direction, goalX);
    }

    if (blockElement.dataset.avType === "table") {
        const rows = getOwnVisibleElements(blockElement, ".av__row[data-id]:not(.av__row--header)");
        const rowElement = rows[direction === "down" ? 0 : rows.length - 1];
        const cellElement = rowElement && getClosestCell(rowElement, goalX);
        if (cellElement) {
            if (!focusBlock(blockElement)) {
                return false;
            }
            clearSelect(["av"], blockElement);
            cellElement.classList.add("av__cell--select");
            addDragFill(cellElement);
            cellScrollIntoView(blockElement, cellElement);
            return true;
        }
    } else {
        const items = getOwnVisibleElements(blockElement, ".av__gallery-item[data-id]");
        const itemElement = items[direction === "down" ? 0 : items.length - 1];
        if (itemElement) {
            if (!focusBlock(blockElement)) {
                return false;
            }
            clearSelect(["av"], blockElement);
            setAVItemAnchor(blockElement, itemElement);
            selectAVItemRange(blockElement, itemElement);
            cellScrollIntoView(blockElement, itemElement);
            return true;
        }
    }

    if (direction === "up" && titleElement) {
        clearSelect(["av"], blockElement);
        return focusEditableAtGoalX(titleElement, direction, goalX);
    }
    return false;
};

export const focusAVByArrow = (protyle: IProtyle, blockElement: HTMLElement, key: string, skipTitle = false) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key) ||
        !blockElement.querySelector(".av__cursor")) {
        return false;
    }

    const toStart = isForwardArrow(key);
    const titleElement = !skipTitle &&
        blockElement.querySelector(".av__title:not(.fn__none)") as HTMLElement;
    if (titleElement && titleElement.getClientRects().length > 0) {
        clearSelect(["av"], blockElement);
        const range = document.createRange();
        range.selectNodeContents(titleElement);
        range.collapse(toStart);
        focusByRange(range);
        return true;
    }

    if (blockElement.dataset.avType !== "table") {
        return false;
    }

    const cellElement = Array.from(blockElement.querySelectorAll<HTMLElement>(".av__row[data-id] .av__cell")).find(
        item => item.getClientRects().length > 0
    );
    if (cellElement && (!skipTitle || toStart)) {
        if (!focusBlock(blockElement)) {
            return false;
        }
        clearSelect(["av"], blockElement);
        cellElement.classList.add("av__cell--select");
        addDragFill(cellElement);
        cellScrollIntoView(blockElement, cellElement);
        return true;
    }

    clearSelect(["av"], blockElement);
    let adjacentElement = toStart ? getNextBlock(blockElement) : getPreviousBlock(blockElement);
    if (!adjacentElement) {
        return true;
    }
    adjacentElement = toStart ? getFirstBlock(adjacentElement) : getLastBlock(adjacentElement);
    if (adjacentElement.classList.contains("av") &&
        focusAVByArrow(protyle, adjacentElement as HTMLElement, key)) {
        scrollCenter(protyle, adjacentElement);
        return true;
    }
    focusBlock(adjacentElement, undefined, toStart);
    scrollCenter(protyle, adjacentElement);
    return true;
};
