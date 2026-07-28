import {matchHotKey} from "../../util/hotKey";
import {deleteRow, insertRows} from "./row";
import {addDragFill, cellScrollIntoView, popTextCell, updateCellsValue} from "./cell";
import {avContextmenu} from "./action";
import {hasClosestByClassName} from "../../util/hasClosest";
import {Constants} from "../../../constants";
import {upDownHint} from "../../../util/upDownHint";
import {clearSelect} from "../../util/clear";
import {getAVSelectedItems} from "./virtualScroll";
import {createAttributeViewItemDocs} from "./newItemTemplate";
import {
    moveAVCellRange,
    moveAVItemRange,
    selectAVItemRange,
    setAVCellAnchor,
    setAVItemAnchor,
} from "./rangeSelect";
import {getAVCellSelection, getAVItemSelection} from "./selectionState";
import {isMobile} from "../../../util/functions";

export const avKeydown = (event: KeyboardEvent, nodeElement: HTMLElement, protyle: IProtyle) => {
    if (!nodeElement.classList.contains("av") || !window.siyuan.menus.menu.element.classList.contains("fn__none")) {
        return false;
    }
    if (event.isComposing) {
        return true;
    }
    // 避免浏览器默认快捷键
    if (matchHotKey("⌘B", event) || matchHotKey("⌘I", event) || matchHotKey("⌘U", event)) {
        event.preventDefault();
        return true;
    }
    const isNewNameFile = matchHotKey(window.siyuan.config.keymap.editor.general.newNameFile.custom, event);
    const isNewNameSettingFile = matchHotKey(window.siyuan.config.keymap.editor.general.newNameSettingFile.custom, event);
    if (isNewNameFile || isNewNameSettingFile) {
        if (event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        const itemIDs = getAVSelectedItems(nodeElement).map(item => item.itemID);
        if (itemIDs.length === 0) {
            const currentCell = nodeElement.querySelector(".av__cell--select, .av__cell--active") as HTMLElement;
            let currentItem: HTMLElement;
            if (currentCell) {
                currentItem = (hasClosestByClassName(currentCell, "av__row") ||
                    hasClosestByClassName(currentCell, "av__gallery-item")) as HTMLElement;
            }
            if (currentItem?.dataset.id) {
                itemIDs.push(currentItem.dataset.id);
            }
        }
        if (!protyle.disabled && itemIDs.length > 0) {
            createAttributeViewItemDocs({
                protyle,
                blockElement: nodeElement,
                itemIDs,
                saveMode: isNewNameFile ? "subDoc" : "template",
            });
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    const cellSelection = getAVCellSelection(nodeElement);
    const selectCellElement = (cellSelection ?
        nodeElement.querySelector(
            `.av__body[data-group-id="${cellSelection.focus.groupID}"] ` +
            `.av__row[data-id="${cellSelection.focus.rowID}"] .av__cell[data-col-id="${cellSelection.focus.colID}"]`) :
        nodeElement.querySelector(".av__cell--select")) as HTMLElement;
    if (!selectCellElement && cellSelection && event.key === "Escape") {
        clearSelect(["cell"], nodeElement);
        event.preventDefault();
        return true;
    }
    if (!selectCellElement && cellSelection && (event.key === "Backspace" || event.key === "Delete")) {
        updateCellsValue(protyle, nodeElement);
        event.preventDefault();
        return true;
    }
    if (!isMobile() && !selectCellElement && cellSelection && event.shiftKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        const previousFocus = `${cellSelection.focus.rowID}:${cellSelection.focus.colID}`;
        const targetElement = moveAVCellRange(nodeElement,
            event.key.replace("Arrow", "").toLowerCase() as "left" | "right" | "up" | "down");
        if (targetElement) {
            cellScrollIntoView(nodeElement, targetElement, ["ArrowUp", "ArrowDown"].includes(event.key));
        } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") &&
            previousFocus !== `${getAVCellSelection(nodeElement)?.focus.rowID}:${getAVCellSelection(nodeElement)?.focus.colID}`) {
            protyle.contentElement.scrollBy({top: event.key === "ArrowUp" ? -48 : 48});
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    if (selectCellElement) {
        const rowElement = hasClosestByClassName(selectCellElement, "av__row");
        if (!rowElement || rowElement.dataset.type === "ghost") {
            return false;
        }
        const avPanelElement = document.querySelector(".av__panel");
        if (avPanelElement &&
            (event.key === "Backspace" || event.key === "Delete" || event.key === "Escape" ||
                event.key.startsWith("ArrowLeft") || event.key === "Enter" || matchHotKey("⇥", event) ||
                matchHotKey("⇧⇥", event))) {
            avPanelElement.remove();
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        // 需在 avPanelElement 之后，否则点击资源单元格后删除，资源面板不会更新
        if (event.key === "Backspace" || event.key === "Delete") {
            updateCellsValue(protyle, nodeElement);
            event.preventDefault();
            return true;
        }
        if (event.key === "Escape") {
            clearSelect(["cell"], nodeElement);
            event.preventDefault();
            return true;
        }
        if (event.key === "Enter") {
            popTextCell(protyle, [selectCellElement]);
            event.preventDefault();
            return true;
        }
        if (!isMobile() && event.shiftKey &&
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
            if (!getAVCellSelection(nodeElement)) {
                setAVCellAnchor(nodeElement, selectCellElement);
            }
            const previousFocus = getAVCellSelection(nodeElement)?.focus;
            const newCellElement = moveAVCellRange(nodeElement,
                event.key.replace("Arrow", "").toLowerCase() as "left" | "right" | "up" | "down");
            if (newCellElement) {
                cellScrollIntoView(nodeElement, newCellElement, ["ArrowUp", "ArrowDown"].includes(event.key));
            } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") &&
                previousFocus?.rowID !== getAVCellSelection(nodeElement)?.focus.rowID) {
                protyle.contentElement.scrollBy({top: event.key === "ArrowUp" ? -48 : 48});
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        let newCellElement;
        if (event.key === "ArrowLeft" || matchHotKey("⇧⇥", event)) {
            const previousRowElement = rowElement.previousElementSibling;
            if (selectCellElement.previousElementSibling && !selectCellElement.previousElementSibling.classList.contains("av__firstcol")) {
                if (selectCellElement.previousElementSibling.classList.contains("av__colsticky")) {
                    newCellElement = selectCellElement.previousElementSibling.lastElementChild;
                    if (newCellElement.classList.contains("av__firstcol")) {
                        newCellElement = undefined;
                    }
                } else if (selectCellElement.previousElementSibling.classList.contains("av__cell")) {
                    newCellElement = selectCellElement.previousElementSibling;
                }
            }
            if (!newCellElement && previousRowElement && !previousRowElement.classList.contains("av__row--header")) {
                const previousCellElements = previousRowElement.querySelectorAll(".av__cell");
                newCellElement = previousCellElements[previousCellElements.length - 1];
            }
            if (newCellElement) {
                clearSelect(["cell"], nodeElement);
                newCellElement.classList.add("av__cell--select");
                addDragFill(newCellElement);
                cellScrollIntoView(nodeElement, newCellElement, false);
            }
            event.preventDefault();
            return true;
        }
        if (event.key === "ArrowRight" || matchHotKey("⇥", event)) {
            const nextRowElement = rowElement.nextElementSibling;
            if (selectCellElement.nextElementSibling && selectCellElement.nextElementSibling.classList.contains("av__cell")) {
                newCellElement = selectCellElement.nextElementSibling;
            } else if (!selectCellElement.nextElementSibling && selectCellElement.parentElement.nextElementSibling) {
                // pin
                newCellElement = selectCellElement.parentElement.nextElementSibling;
            } else if (nextRowElement && !nextRowElement.classList.contains("av__row--footer")) {
                newCellElement = nextRowElement.querySelector(".av__cell");
            }
            if (newCellElement) {
                clearSelect(["cell"], nodeElement);
                newCellElement.classList.add("av__cell--select");
                addDragFill(newCellElement);
                cellScrollIntoView(nodeElement, newCellElement, false);
            } else if (event.key !== "ArrowRight") {
                clearSelect(["cell"], nodeElement);
                insertRows({
                    blockElement: nodeElement,
                    protyle,
                    count: 1,
                    previousID: rowElement.getAttribute("data-id"),
                    groupID: rowElement.parentElement.getAttribute("data-group-id")
                });
            }
            event.preventDefault();
            return true;
        }
        if (event.key === "ArrowUp") {
            const previousRowElement = rowElement.previousElementSibling;
            if (previousRowElement && !previousRowElement.classList.contains("av__row--header")) {
                newCellElement = previousRowElement.querySelector(`.av__cell[data-col-id="${selectCellElement.dataset.colId}"]`);
            }
            if (newCellElement) {
                clearSelect(["cell"], nodeElement);
                newCellElement.classList.add("av__cell--select");
                addDragFill(newCellElement);
                cellScrollIntoView(nodeElement, newCellElement);
            }
            event.preventDefault();
            return true;
        }
        if (event.key === "ArrowDown") {
            const nextRowElement = rowElement.nextElementSibling;
            if (nextRowElement && !nextRowElement.classList.contains("av__row--footer")) {
                newCellElement = nextRowElement.querySelector(`.av__cell[data-col-id="${selectCellElement.dataset.colId}"]`);
            }
            if (newCellElement) {
                clearSelect(["cell"], nodeElement);
                newCellElement.classList.add("av__cell--select");
                addDragFill(newCellElement);
                cellScrollIntoView(nodeElement, newCellElement);
            }
            event.preventDefault();
            return true;
        }

        if (!Constants.KEYCODELIST[event.keyCode] ||
            (Constants.KEYCODELIST[event.keyCode].length === 1 &&
                !event.metaKey && !event.ctrlKey &&
                !["⇧", "⌃", "⌥", "⌘"].includes(Constants.KEYCODELIST[event.keyCode]))) {
            if (!selectCellElement.style.backgroundColor) {
                popTextCell(protyle, [selectCellElement]);
            } else {
                event.preventDefault();
            }
            return true;
        }
    }
    const selectRowElements = nodeElement.querySelectorAll(
        ".av__row--select:not(.av__row--header), .av__gallery-item--select");
    const itemSelection = getAVItemSelection(nodeElement);
    if (!isMobile() && selectRowElements.length === 0 && itemSelection && event.shiftKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        const previousFocus = `${itemSelection.focusGroupID}:${itemSelection.focusID}`;
        const targetElement = moveAVItemRange(nodeElement, event.key === "ArrowUp" ? "up" : "down");
        if (targetElement) {
            cellScrollIntoView(nodeElement, targetElement);
        } else {
            const nextSelection = getAVItemSelection(nodeElement);
            if (previousFocus !== `${nextSelection?.focusGroupID}:${nextSelection?.focusID}`) {
                protyle.contentElement.scrollBy({top: event.key === "ArrowUp" ? -48 : 48});
            }
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    if (selectRowElements.length === 0 && getAVSelectedItems(nodeElement).length > 0) {
        if (event.key === "Escape") {
            clearSelect(["row", "galleryItem"], nodeElement);
            event.preventDefault();
            return true;
        }
        if (event.key === "Backspace") {
            deleteRow(nodeElement, protyle);
            event.preventDefault();
            return true;
        }
    }
    if (selectRowElements.length > 0) {
        if (matchHotKey("⌘/", event)) {
            event.stopPropagation();
            event.preventDefault();
            avContextmenu(protyle, selectRowElements[0] as HTMLElement, {
                x: nodeElement.querySelector(".layout-tab-bar").getBoundingClientRect().left,
                y: selectRowElements[0].getBoundingClientRect().bottom
            });
            return true;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            clearSelect(["row", "galleryItem"], nodeElement);
            return true;
        }
        if (event.key === "Backspace") {
            event.preventDefault();
            deleteRow(nodeElement, protyle);
            return true;
        }
        if (event.key === "Enter") {
            clearSelect(["row", "galleryItem"], nodeElement);
            popTextCell(protyle, [selectRowElements[0].querySelector(".av__cell")]);
            event.preventDefault();
            return true;
        }
        if (!isMobile() && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            if (!getAVItemSelection(nodeElement)) {
                setAVItemAnchor(nodeElement, selectRowElements[event.key === "ArrowUp" ? 0 :
                    selectRowElements.length - 1] as HTMLElement);
            }
            const previousSelection = getAVItemSelection(nodeElement);
            const previousFocus = `${previousSelection?.focusGroupID}:${previousSelection?.focusID}`;
            const targetElement = moveAVItemRange(nodeElement, event.key === "ArrowUp" ? "up" : "down");
            if (targetElement) {
                cellScrollIntoView(nodeElement, targetElement);
            } else {
                const nextSelection = getAVItemSelection(nodeElement);
                if (previousFocus !== `${nextSelection?.focusGroupID}:${nextSelection?.focusID}`) {
                    protyle.contentElement.scrollBy({top: event.key === "ArrowUp" ? -48 : 48});
                }
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (event.key === "ArrowUp") {
            const previousRowElement = selectRowElements[0].previousElementSibling as HTMLElement;
            clearSelect(["row", "galleryItem"], nodeElement);
            if (previousRowElement?.matches(".av__row[data-id], .av__gallery-item[data-id]")) {
                setAVItemAnchor(nodeElement, previousRowElement as HTMLElement);
                selectAVItemRange(nodeElement, previousRowElement);
                cellScrollIntoView(nodeElement, previousRowElement);
            } else {
                nodeElement.classList.add("protyle-wysiwyg--select");
            }
            event.preventDefault();
            return true;
        }
        if (event.key === "ArrowDown") {
            const nextRowElement = selectRowElements[selectRowElements.length - 1].nextElementSibling as HTMLElement;
            clearSelect(["row", "galleryItem"], nodeElement);
            if (nextRowElement?.matches(".av__row[data-id], .av__gallery-item[data-id]")) {
                setAVItemAnchor(nodeElement, nextRowElement as HTMLElement);
                selectAVItemRange(nodeElement, nextRowElement);
                cellScrollIntoView(nodeElement, nextRowElement);
            } else {
                nodeElement.classList.add("protyle-wysiwyg--select");
            }
            event.preventDefault();
            return true;
        }
    }
    return false;
};

export const bindAVPanelKeydown = (event: KeyboardEvent) => {
    const avPanelElement = document.querySelector(".av__panel");
    if (avPanelElement && window.siyuan.menus.menu.element.classList.contains("fn__none")) {
        if ((avPanelElement.querySelector('[data-type="goSearchRollupCol"]') && !avPanelElement.querySelector(".b3-text-field")) ||
            avPanelElement.querySelector('[data-type="addAssetExist"]')) {
            const menuElement = avPanelElement.querySelector(".b3-menu__items");
            if (event.key === "Enter") {
                const currentElement = menuElement.querySelector(".b3-menu__item--current");
                if (currentElement) {
                    const editElement = currentElement.querySelector('[data-type="editAssetItem"]');
                    const uploadElement = currentElement.querySelector(".b3-form__upload");
                    if (editElement) {
                        avPanelElement.dispatchEvent(new CustomEvent("click", {
                            detail: {
                                type: editElement.getAttribute("data-type"),
                                target: editElement
                            }
                        }));
                    } else if (uploadElement) {
                        uploadElement.dispatchEvent(new MouseEvent("click", {bubbles: true}));
                    } else {
                        avPanelElement.dispatchEvent(new CustomEvent("click", {
                            detail: {
                                type: currentElement.getAttribute("data-type"),
                                target: currentElement
                            }
                        }));
                    }
                    return true;
                }
            } else if (event.key === "Escape") {
                avPanelElement.dispatchEvent(new CustomEvent("click", {detail: "close"}));
                return true;
            } else if (upDownHint(menuElement, event, "b3-menu__item--current", menuElement.firstElementChild)) {
                return true;
            }
        }
    }
    return false;
};
