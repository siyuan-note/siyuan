import {matchHotKey} from "../../util/hotKey";
import {selectRow, updateHeader} from "./row";
import {cellScrollIntoView} from "./cell";

export const avKeydown = (event: KeyboardEvent, nodeElement: HTMLElement) => {
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
    const selectCellElement = nodeElement.querySelector(".av__cell--select")
    if (selectCellElement) {
        if (event.key === "Escape") {
            selectCellElement.classList.remove("av__cell--select");
            selectRow(selectCellElement.parentElement.querySelector(".av__firstcol"), "select");
            event.preventDefault();
            return true;
        }
        if (event.key === "Enter") {
            // TODO
            event.preventDefault();
            return true;
        }
        let cellRect
        if (event.key === "ArrowLeft") {
            const previousRowElement = selectCellElement.parentElement.previousElementSibling
            if (selectCellElement.previousElementSibling && selectCellElement.previousElementSibling.classList.contains("av__cell")) {
                selectCellElement.classList.remove("av__cell--select");
                selectCellElement.previousElementSibling.classList.add("av__cell--select");
                cellRect = nodeElement.querySelector(".av__cell--select").getBoundingClientRect();
            } else if (previousRowElement && !previousRowElement.classList.contains("av__row--header")) {
                selectCellElement.classList.remove("av__cell--select");
                previousRowElement.lastElementChild.previousElementSibling.classList.add("av__cell--select");
                cellRect = nodeElement.querySelector(".av__cell--select").getBoundingClientRect();
            }
            if (cellRect) {
                cellScrollIntoView(nodeElement, cellRect);
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

