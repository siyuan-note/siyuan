import {Menu} from "../../../plugin/Menu";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";
import {transaction} from "../../wysiwyg/transaction";
import {openEditorTab} from "../../../menus/util";
import {copySubMenu} from "../../../menus/commonMenuItem";
import {
    addDragFill,
    genCellValueByElement,
    getCellText,
    getTypeByCellElement,
    popTextCell,
    renderCell,
    renderCellAttr,
    updateCellsValue,
    updateHeaderCell
} from "./cell";
import {addCol, getColIconByType, showColMenu} from "./col";
import {deleteRow, insertRows, selectRow, setPageSize, updateHeader} from "./row";
import {emitOpenMenu} from "../../../plugin/EventBus";
import {openMenuPanel} from "./openMenuPanel";
import {hintRef} from "../../hint/extend";
import {focusBlock, focusByRange} from "../../util/selection";
import {showMessage} from "../../../dialog/message";
import {previewImage} from "../../preview/image";
import {unicode2Emoji} from "../../../emoji";
import * as dayjs from "dayjs";
import {openCalcMenu} from "./calc";
import {avRender} from "./render";
import {addView, openViewMenu} from "./view";
import {isOnlyMeta, writeText} from "../../util/compatibility";
import {openSearchAV} from "./relation";
import {Constants} from "../../../constants";
import {hideElements} from "../../ui/hideElements";
import {fetchPost} from "../../../util/fetch";
import {scrollCenter} from "../../../util/highlightById";

export const avClick = (protyle: IProtyle, event: MouseEvent & { target: HTMLElement }) => {
    if (isOnlyMeta(event)) {
        return false;
    }
    const blockElement = hasClosestBlock(event.target);
    if (!blockElement) {
        return false;
    }
    const loadMoreElement = hasClosestByAttribute(event.target, "data-type", "av-load-more");
    if (loadMoreElement) {
        (blockElement.querySelector(".av__row--footer") as HTMLElement).style.transform = "";
        blockElement.removeAttribute("data-render");
        blockElement.dataset.pageSize = (parseInt(blockElement.dataset.pageSize) + parseInt(blockElement.querySelector('[data-type="set-page-size"]').getAttribute("data-size"))).toString();
        avRender(blockElement, protyle);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    const firstColElement = hasClosestByClassName(event.target, "av__firstcol");
    if (firstColElement) {
        window.siyuan.menus.menu.remove();
        selectRow(firstColElement, "toggle");
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    const imgElement = hasClosestByClassName(event.target, "av__cellassetimg");
    if (imgElement) {
        previewImage((imgElement as HTMLImageElement).src);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    if (event.shiftKey) {
        const rowElement = hasClosestByClassName(event.target, "av__row");
        if (rowElement && !rowElement.classList.contains("av__row--header")) {
            selectRow(rowElement.querySelector(".av__firstcol"), "toggle");
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
    }
    const copyElement = hasClosestByAttribute(event.target, "data-type", "copy");
    if (copyElement) {
        writeText(getCellText(hasClosestByClassName(copyElement, "av__cell")));
        showMessage(window.siyuan.languages.copied);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const searchIconElement = hasClosestByAttribute(event.target, "data-type", "av-search-icon");
    if (searchIconElement) {
        const searchElement = blockElement.querySelector('input[data-type="av-search"]') as HTMLInputElement;
        searchElement.style.width = "128px";
        searchElement.style.paddingLeft = "";
        searchElement.style.paddingRight = "";
        setTimeout(() => {
            searchElement.focus();
        }, Constants.TIMEOUT_TRANSITION);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const viewItemElement = hasClosestByClassName(event.target, "item");
    if (viewItemElement && viewItemElement.parentElement.classList.contains("layout-tab-bar")) {
        if (viewItemElement.classList.contains("item--focus")) {
            openViewMenu({protyle, blockElement, element: viewItemElement});
        } else {
            blockElement.removeAttribute("data-render");
            avRender(blockElement, protyle, undefined, viewItemElement.dataset.id);
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }


    if (protyle.disabled) {
        return false;
    }

    let target = event.target;
    while (target && !target.isEqualNode(blockElement)) {
        const type = target.getAttribute("data-type");
        if (type === "av-header-add") {
            const addMenu = addCol(protyle, blockElement);
            const addRect = target.getBoundingClientRect();
            addMenu.open({
                x: addRect.left,
                y: addRect.bottom,
                h: addRect.height
            });
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-header-more") {
            openMenuPanel({protyle, blockElement, type: "properties"});
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-add-more") {
            insertRows(blockElement, protyle, 1, undefined);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-more") {
            openMenuPanel({protyle, blockElement, type: "config"});
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-switcher") {
            openMenuPanel({protyle, blockElement, type: "switcher"});
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-sort") {
            openMenuPanel({protyle, blockElement, type: "sorts"});
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-filter") {
            openMenuPanel({protyle, blockElement, type: "filters"});
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-add") {
            addView(protyle, blockElement);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "block-more") {
            window.siyuan.menus.menu.remove();
            protyle.toolbar.range = document.createRange();
            protyle.toolbar.range.selectNodeContents(target);
            focusByRange(protyle.toolbar.range);
            target.parentElement.classList.add("av__cell--select");
            addDragFill(target.parentElement);
            hintRef(target.previousElementSibling.textContent.trim(), protyle, "av");
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "set-page-size") {
            setPageSize({
                target,
                protyle,
                avID: blockElement.getAttribute("data-av-id"),
                nodeElement: blockElement
            });
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-add-bottom") {
            insertRows(blockElement, protyle, 1, blockElement.querySelector(".av__row--util").previousElementSibling.getAttribute("data-id") || "");
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__cell--header")) {
            showColMenu(protyle, blockElement, target);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__cell")) {
            if (!hasClosestByClassName(target, "av__row--header")) {
                const scrollElement = hasClosestByClassName(target, "av__scroll");
                if (!scrollElement || target.querySelector(".av__pulse")) {
                    return;
                }
                const rowElement = hasClosestByClassName(target, "av__row");
                if (!rowElement) {
                    return;
                }
                const type = getTypeByCellElement(target);
                // TODO 点击单元格的时候， lineNumber 选中整行
                if (type === "updated" || type === "created" || type === "lineNumber" || (type === "block" && !target.getAttribute("data-detached"))) {
                    selectRow(rowElement.querySelector(".av__firstcol"), "toggle");
                } else {
                    scrollElement.querySelectorAll(".av__row--select").forEach(item => {
                        item.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconUncheck");
                        item.classList.remove("av__row--select");
                    });
                    updateHeader(rowElement);
                    popTextCell(protyle, [target]);
                }
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__calc")) {
            openCalcMenu(protyle, target);
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        target = target.parentElement;
    }
    return false;
};

export const avContextmenu = (protyle: IProtyle, rowElement: HTMLElement, position: IPosition) => {
    hideElements(["hint"], protyle);
    if (rowElement.classList.contains("av__row--header")) {
        return false;
    }
    const blockElement = hasClosestBlock(rowElement);
    if (!blockElement) {
        return false;
    }
    blockElement.querySelectorAll(".av__cell--select, .av__cell--active").forEach(item => {
        item.classList.remove("av__cell--select", "av__cell--active");
        item.querySelector(".av__drag-fill")?.remove();
    });
    if (!rowElement.classList.contains("av__row--select")) {
        blockElement.querySelectorAll(".av__row--select").forEach(item => {
            item.classList.remove("av__row--select");
        });
        blockElement.querySelectorAll(".av__firstcol use").forEach(item => {
            item.setAttribute("xlink:href", "#iconUncheck");
        });
    }

    const menu = new Menu("av-row-menu");
    if (menu.isOpen) {
        return true;
    }
    rowElement.classList.add("av__row--select");
    rowElement.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconCheck");
    const rowElements = blockElement.querySelectorAll(".av__row--select:not(.av__row--header)");
    updateHeader(rowElement);
    const keyCellElement = rowElements[0].querySelector(".av__cell[data-block-id]") as HTMLElement;
    if (rowElements.length === 1 && keyCellElement.getAttribute("data-detached") !== "true") {
        const blockId = rowElements[0].getAttribute("data-id");
        openEditorTab(protyle.app, [blockId]);
        menu.addItem({
            label: window.siyuan.languages.copy,
            icon: "iconCopy",
            type: "submenu",
            submenu: copySubMenu(blockId)
        });
    }
    if (!protyle.disabled) {
        menu.addItem({
            label: window.siyuan.languages.addToDatabase,
            icon: "iconDatabase",
            click() {
                openSearchAV(blockElement.getAttribute("data-av-id"), rowElements[0] as HTMLElement, (listItemElement) => {
                    const srcs: IOperationSrcs[] = [];
                    const sourceIds: string[] = [];
                    rowElements.forEach(item => {
                        const rowId = item.getAttribute("data-id");
                        const blockValue = genCellValueByElement("block", item.querySelector(".av__cell[data-block-id]"));
                        srcs.push({
                            content: blockValue.block.content,
                            id: rowId,
                            isDetached: blockValue.isDetached,
                        });
                        sourceIds.push(rowId);
                    });
                    const avID = listItemElement.dataset.avId;
                    transaction(protyle, [{
                        action: "insertAttrViewBlock",
                        avID,
                        ignoreFillFilter: true,
                        srcs,
                        blockID: listItemElement.dataset.blockId
                    }, {
                        action: "doUpdateUpdated",
                        id: listItemElement.dataset.blockId,
                        data: dayjs().format("YYYYMMDDHHmmss"),
                    }], [{
                        action: "removeAttrViewBlock",
                        srcIDs: sourceIds,
                        avID,
                    }]);
                });
            }
        });
        if (rowElements.length === 1) {
            if (keyCellElement.getAttribute("data-detached") !== "true") {
                menu.addSeparator();
            }
            menu.addItem({
                icon: "iconBefore",
                label: `<div class="fn__flex" style="align-items: center;">
${window.siyuan.languages.insertRowBefore.replace("${x}", '<span class="fn__space"></span><input style="width:64px" type="number" step="1" min="1" value="1" placeholder="${window.siyuan.languages.enterKey}" class="b3-text-field"><span class="fn__space"></span>')}
</div>`,
                bind(element) {
                    const inputElement = element.querySelector("input");
                    element.addEventListener("click", () => {
                        if (document.activeElement.isSameNode(inputElement)) {
                            return;
                        }
                        insertRows(blockElement, protyle, parseInt(inputElement.value), rowElements[0].previousElementSibling.getAttribute("data-id"));
                        menu.close();
                    });
                    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                        if (!event.isComposing && event.key === "Enter") {
                            insertRows(blockElement, protyle, parseInt(inputElement.value), rowElements[0].previousElementSibling.getAttribute("data-id"));
                            menu.close();
                        }
                    });
                }
            });
            menu.addItem({
                icon: "iconAfter",
                label: `<div class="fn__flex" style="align-items: center;">
${window.siyuan.languages.insertRowAfter.replace("${x}", '<span class="fn__space"></span><input style="width:64px" type="number" step="1" min="1" placeholder="${window.siyuan.languages.enterKey}" class="b3-text-field" value="1"><span class="fn__space"></span>')}
</div>`,
                bind(element) {
                    const inputElement = element.querySelector("input");
                    element.addEventListener("click", () => {
                        if (document.activeElement.isSameNode(inputElement)) {
                            return;
                        }
                        insertRows(blockElement, protyle, parseInt(inputElement.value), rowElements[0].getAttribute("data-id"));
                        menu.close();
                    });
                    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                        if (!event.isComposing && event.key === "Enter") {
                            insertRows(blockElement, protyle, parseInt(inputElement.value), rowElements[0].getAttribute("data-id"));
                            menu.close();
                        }
                    });
                }
            });
            menu.addSeparator();
            if (keyCellElement.getAttribute("data-detached") !== "true") {
                menu.addItem({
                    label: window.siyuan.languages.unbindBlock,
                    icon: "iconLinkOff",
                    click() {
                        updateCellsValue(protyle, blockElement, keyCellElement.querySelector(".av__celltext").textContent, [keyCellElement]);
                    }
                });
            }
        }
        menu.addItem({
            icon: "iconTrashcan",
            label: window.siyuan.languages.delete,
            click() {
                deleteRow(blockElement, protyle);
            }
        });
        const editAttrSubmenu: IMenu[] = [];
        rowElement.parentElement.querySelectorAll(".av__row--header .av__cell").forEach((cellElement: HTMLElement) => {
            let hideBlock = false;
            const selectElements: HTMLElement[] = Array.from(blockElement.querySelectorAll(`.av__row--select:not(.av__row--header) .av__cell[data-col-id="${cellElement.dataset.colId}"]`));
            if (cellElement.dataset.dtype === "block") {
                selectElements.find(item => {
                    if (!item.dataset.detached) {
                        hideBlock = true;
                        return true;
                    }
                });
            }
            const type = cellElement.getAttribute("data-dtype") as TAVCol;
            if (!hideBlock && !["updated", "created"].includes(type)) {
                const icon = cellElement.dataset.icon;
                editAttrSubmenu.push({
                    iconHTML: icon ? unicode2Emoji(icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(type)}"></use></svg>`,
                    label: cellElement.querySelector(".av__celltext").textContent.trim(),
                    click() {
                        popTextCell(protyle, selectElements);
                    }
                });
            }
        });
        menu.addItem({
            icon: "iconAttr",
            label: window.siyuan.languages.attr,
            type: "submenu",
            submenu: editAttrSubmenu
        });
    }
    if (protyle?.app?.plugins) {
        emitOpenMenu({
            plugins: protyle.app.plugins,
            type: "open-menu-av",
            detail: {
                protyle,
                element: blockElement,
                selectRowElements: rowElements,
            },
            separatorPosition: "top",
        });
    }
    menu.open(position);
    return true;
};

export const updateAVName = (protyle: IProtyle, blockElement: Element) => {
    const avId = blockElement.getAttribute("data-av-id");
    const id = blockElement.getAttribute("data-node-id");
    const nameElement = blockElement.querySelector(".av__title") as HTMLElement;
    const newData = nameElement.textContent.trim();
    if (newData === nameElement.dataset.title.trim()) {
        return;
    }
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    transaction(protyle, [{
        action: "setAttrViewName",
        id: avId,
        data: newData,
    }, {
        action: "doUpdateUpdated",
        id,
        data: newUpdated,
    }], [{
        action: "setAttrViewName",
        id: avId,
        data: nameElement.dataset.title,
    }, {
        action: "doUpdateUpdated",
        id,
        data: blockElement.getAttribute("updated")
    }]);
    blockElement.setAttribute("updated", newUpdated);
    nameElement.dataset.title = newData;

    // 当前页面不能进行推送，否则光标会乱跳
    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${avId}"]`)).forEach((item: HTMLElement) => {
        if (blockElement.isSameNode(item)) {
            return;
        }
        const titleElement = item.querySelector(".av__title") as HTMLElement;
        if (!titleElement) {
            return;
        }
        titleElement.textContent = newData;
        titleElement.dataset.title = newData;
    });
};

export const updateAttrViewCellAnimation = (cellElement: HTMLElement, value: IAVCellValue, headerValue?: {
    icon?: string,
    name?: string,
    pin?: boolean,
    type?: TAVCol
}) => {
    // 属性面板更新列名
    if (!cellElement) {
        return;
    }
    if (headerValue) {
        updateHeaderCell(cellElement, headerValue);
    } else {
        const hasDragFill = cellElement.querySelector(".av__drag-fill");
        cellElement.innerHTML = renderCell(value);
        if (hasDragFill) {
            addDragFill(cellElement);
        }
        renderCellAttr(cellElement, value);
    }
};

export const removeAttrViewColAnimation = (blockElement: Element, id: string) => {
    blockElement.querySelectorAll(`.av__cell[data-col-id="${id}"]`).forEach(item => {
        item.remove();
    });
};

export const duplicateCompletely = (protyle:IProtyle, nodeElement:HTMLElement) => {
    fetchPost("/api/av/duplicateAttributeViewBlock", {avID: nodeElement.getAttribute("data-av-id")}, (response) => {
        nodeElement.classList.remove("protyle-wysiwyg--select");
        const tempElement = document.createElement("template");
        tempElement.innerHTML = protyle.lute.SpinBlockDOM(`<div data-node-id="${response.data.blockID}" data-av-id="${response.data.avID}" data-type="NodeAttributeView" data-av-type="table"></div>`);
        const cloneElement = tempElement.content.firstElementChild;
        nodeElement.after(cloneElement);
        avRender(cloneElement, protyle, () => {
            focusBlock(cloneElement);
            scrollCenter(protyle);
        });
        transaction(protyle, [{
            action: "insert",
            data: cloneElement.outerHTML,
            id: response.data.blockID,
            previousID: nodeElement.dataset.nodeId,
        }], [{
            action: "delete",
            id: response.data.blockID,
        }]);
    });
};
