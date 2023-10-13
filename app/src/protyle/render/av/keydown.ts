import {matchHotKey} from "../../util/hotKey";
import {selectRow, updateHeader} from "./row";
import {cellScrollIntoView, popTextCell} from "./cell";

export const avKeydown = (event: KeyboardEvent, nodeElement: HTMLElement, protyle: IProtyle) => {
    if (!nodeElement.classList.contains("av")) {
        return false;
    }
    if (event.isComposing) {
        event.stopPropagation();
        return true;
    }
    // 避免浏览器默认快捷键
    if (matchHotKey("⌘B", event) || matchHotKey("⌘I", event) || matchHotKey("⌘U", event)) {
        event.preventDefault();
        return true;
    }
    const selectCellElement = nodeElement.querySelector(".av__cell--select") as HTMLElement;
    if (selectCellElement) {
        if (event.key === "Escape") {
            selectCellElement.classList.remove("av__cell--select");
            selectRow(selectCellElement.parentElement.querySelector(".av__firstcol"), "select");
            event.preventDefault();
            return true;
        }
        if (event.key === "Enter") {
            popTextCell(protyle, [selectCellElement]);
            event.preventDefault();
            return true;
        }
        let newCellElement
        if (event.key === "ArrowLeft") {
            const previousRowElement = selectCellElement.parentElement.previousElementSibling
            if (selectCellElement.previousElementSibling && selectCellElement.previousElementSibling.classList.contains("av__cell")) {
                newCellElement = selectCellElement.previousElementSibling
            } else if (previousRowElement && !previousRowElement.classList.contains("av__row--header")) {
                newCellElement = previousRowElement.lastElementChild.previousElementSibling
            }
            if (newCellElement) {
                selectCellElement.classList.remove("av__cell--select");
                newCellElement.classList.add("av__cell--select");
                cellScrollIntoView(nodeElement, newCellElement.getBoundingClientRect());
            }
            event.preventDefault();
            return true;
        }
        if (event.key === "ArrowRight") {
            const nextRowElement = selectCellElement.parentElement.nextElementSibling
            if (selectCellElement.nextElementSibling && selectCellElement.nextElementSibling.classList.contains("av__cell")) {
                newCellElement = selectCellElement.nextElementSibling
            } else if (nextRowElement && !nextRowElement.classList.contains("av__row--footer")) {
                newCellElement = nextRowElement.querySelector(".av__cell")
            }
            if (newCellElement) {
                selectCellElement.classList.remove("av__cell--select");
                newCellElement.classList.add("av__cell--select");
                cellScrollIntoView(nodeElement, newCellElement.getBoundingClientRect());
            }
            event.preventDefault();
            return true;
        }
        if (event.key === "ArrowUp") {
            const previousRowElement = selectCellElement.parentElement.previousElementSibling
            if (previousRowElement && !previousRowElement.classList.contains("av__row--header")) {
                newCellElement = previousRowElement.querySelector(`.av__cell[data-col-id="${selectCellElement.dataset.colId}"]`)
            }
            if (newCellElement) {
                selectCellElement.classList.remove("av__cell--select");
                newCellElement.classList.add("av__cell--select");
                cellScrollIntoView(nodeElement, newCellElement.getBoundingClientRect());
            }
            event.preventDefault();
            return true;
        }
        if (event.key === "ArrowDown") {
            const nextRowElement = selectCellElement.parentElement.nextElementSibling
            if (nextRowElement && !nextRowElement.classList.contains("av__row--footer")) {
                newCellElement = nextRowElement.querySelector(`.av__cell[data-col-id="${selectCellElement.dataset.colId}"]`)
            }
            if (newCellElement) {
                selectCellElement.classList.remove("av__cell--select");
                newCellElement.classList.add("av__cell--select");
                cellScrollIntoView(nodeElement, newCellElement.getBoundingClientRect());
            }
            event.preventDefault();
            return true;
        }
    }

    const selectRowElement = nodeElement.querySelector(".av__row--select:not(.av__row--header)") as HTMLElement;
    if (selectRowElement) {
        if (event.key === "Escape") {
            selectRowElement.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconUncheck");
            selectRowElement.classList.remove("av__row--select");
            updateHeader(selectRowElement);
            return true;
        }
        // event.shiftKey
        if (event.key === "ArrowUp") {
            return true;
        }
    }
    return false;
}

