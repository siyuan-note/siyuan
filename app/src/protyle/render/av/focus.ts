import {addDragFill, cellScrollIntoView} from "./cell";
import {clearSelect} from "../../util/clear";
import {focusBlock, focusByRange} from "../../util/selection";
import {getFirstBlock, getLastBlock, getNextBlock, getPreviousBlock} from "../../wysiwyg/getBlock";
import {scrollCenter} from "../../../util/highlightById";

const isForwardArrow = (key: string) => key === "ArrowDown" || key === "ArrowRight";

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
