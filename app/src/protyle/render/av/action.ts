import {Menu} from "../../../plugin/Menu";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";
import {transaction} from "../../wysiwyg/transaction";
import {openEditorTab} from "../../../menus/util";
import {copySubMenu} from "../../../menus/commonMenuItem";
import {openCalcMenu, popTextCell} from "./cell";
import {getColIconByType, showColMenu} from "./col";
import {insertAttrViewBlockAnimation, updateHeader} from "./row";
import {emitOpenMenu} from "../../../plugin/EventBus";
import {addCol} from "./col";
import {openMenuPanel} from "./openMenuPanel";
import {hintRef} from "../../hint/extend";
import {focusByRange} from "../../util/selection";
import {writeText} from "../../util/compatibility";
import {showMessage} from "../../../dialog/message";
import {previewImage} from "../../preview/image";
import {isLocalPath, pathPosix} from "../../../util/pathName";
import {Constants} from "../../../constants";
/// #if !MOBILE
import {openAsset} from "../../../editor/util";
/// #endif
import {getSearch} from "../../../util/functions";
import {unicode2Emoji} from "../../../emoji";
import {selectRow} from "./row";
import * as dayjs from "dayjs";

export const avClick = (protyle: IProtyle, event: MouseEvent & { target: HTMLElement }) => {
    const blockElement = hasClosestBlock(event.target);
    if (!blockElement) {
        return false;
    }
    if (event.shiftKey) {
        const rowElement = hasClosestByClassName(event.target, "av__row");
        if (rowElement && !rowElement.classList.contains("av__row--header")) {
            selectRow(rowElement.querySelector(".av__firstcol"), "toggle");
            return true;
        }
    }

    const copyElement = hasClosestByAttribute(event.target, "data-type", "copy");
    if (copyElement) {
        writeText(copyElement.previousElementSibling.textContent.trim());
        showMessage(window.siyuan.languages.copied);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    if (protyle.disabled) {
        return false;
    }

    const addElement = hasClosestByAttribute(event.target, "data-type", "av-header-add");
    if (addElement) {
        const addMenu = addCol(protyle, blockElement);
        const addRect = addElement.getBoundingClientRect();
        addMenu.open({
            x: addRect.left,
            y: addRect.bottom,
            h: addRect.height
        });
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const gutterElement = hasClosestByClassName(event.target, "av__gutters");
    if (gutterElement) {
        const gutterRect = gutterElement.getBoundingClientRect();
        avContextmenu(protyle, gutterElement.parentElement, {
            x: gutterRect.left,
            y: gutterRect.bottom,
            w: gutterRect.width,
            h: gutterRect.height
        });
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const checkElement = hasClosestByClassName(event.target, "av__firstcol");
    if (checkElement) {
        window.siyuan.menus.menu.remove();
        selectRow(checkElement, "toggle");
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const headerMoreElement = hasClosestByAttribute(event.target, "data-type", "av-header-more");
    if (headerMoreElement) {
        openMenuPanel({protyle, blockElement, type: "properties"});
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const moreElement = hasClosestByAttribute(event.target, "data-type", "av-more");
    if (moreElement) {
        openMenuPanel({protyle, blockElement, type: "config"});
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const sortsElement = hasClosestByAttribute(event.target, "data-type", "av-sort");
    if (sortsElement) {
        openMenuPanel({protyle, blockElement, type: "sorts"});
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const filtersElement = hasClosestByAttribute(event.target, "data-type", "av-filter");
    if (filtersElement) {
        openMenuPanel({protyle, blockElement, type: "filters"});
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const linkElement = hasClosestByClassName(event.target, "av__celltext--url");
    if (linkElement) {
        let linkAddress = linkElement.textContent.trim();
        if (linkElement.dataset.type === "phone") {
            linkAddress = "tel:" + linkAddress;
        } else if (linkElement.dataset.type === "email") {
            linkAddress = "mailto:" + linkAddress;
        } else if (linkElement.classList.contains("b3-chip")) {
            linkAddress = linkElement.dataset.url;
        }
        /// #if !MOBILE
        const suffix = pathPosix().extname(linkAddress);
        if (isLocalPath(linkAddress) && (
            [".pdf"].concat(Constants.SIYUAN_ASSETS_AUDIO).concat(Constants.SIYUAN_ASSETS_VIDEO).includes(suffix) && (
                suffix !== ".pdf" || (suffix === ".pdf" && !linkAddress.startsWith("file://"))
            )
        )) {
            openAsset(protyle.app, linkAddress.trim(), parseInt(getSearch("page", linkAddress)), "right");
        } else {
            window.open(linkAddress);
        }
        /// #else
        window.open(linkAddress);
        /// #endif

        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const imgElement = hasClosestByClassName(event.target, "av__cellassetimg") as HTMLImageElement;
    if (imgElement) {
        previewImage(imgElement.src);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const cellHeaderElement = hasClosestByClassName(event.target, "av__cellheader");
    if (cellHeaderElement) {
        showColMenu(protyle, blockElement, cellHeaderElement.parentElement);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const blockMoreElement = hasClosestByAttribute(event.target, "data-type", "block-more");
    if (blockMoreElement) {
        protyle.toolbar.range = document.createRange();
        protyle.toolbar.range.selectNodeContents(blockMoreElement);
        focusByRange(protyle.toolbar.range);
        hintRef(blockMoreElement.previousElementSibling.textContent.trim(), protyle, "av");
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const cellElement = hasClosestByClassName(event.target, "av__cell");
    if (cellElement && !cellElement.parentElement.classList.contains("av__row--header")) {
        const type = cellElement.parentElement.parentElement.firstElementChild.querySelector(`[data-col-id="${cellElement.getAttribute("data-col-id")}"]`).getAttribute("data-dtype") as TAVCol;
        if (type === "updated" || type === "created" || (type === "block" && !cellElement.getAttribute("data-detached"))) {
            selectRow(cellElement.parentElement.querySelector(".av__firstcol"), "toggle");
        } else {
            cellElement.parentElement.parentElement.querySelectorAll(".av__row--select").forEach(item => {
                item.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconUncheck");
                item.classList.remove("av__row--select");
            });
            updateHeader(cellElement.parentElement);
            popTextCell(protyle, [cellElement]);
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const calcElement = hasClosestByClassName(event.target, "av__calc");
    if (calcElement) {
        openCalcMenu(protyle, calcElement);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const addRowElement = hasClosestByClassName(event.target, "av__row--add");
    if (addRowElement) {
        const avID = blockElement.getAttribute("data-av-id");
        const srcIDs = [Lute.NewNodeID()];
        const previousID = addRowElement.previousElementSibling.getAttribute("data-id") || "";
        transaction(protyle, [{
            action: "insertAttrViewBlock",
            avID,
            previousID,
            srcIDs,
            isDetached: true,
        }], [{
            action: "removeAttrViewBlock",
            srcIDs,
            avID,
        }]);
        insertAttrViewBlockAnimation(blockElement, 1, previousID, avID);
        popTextCell(protyle, [addRowElement.previousElementSibling.querySelector('[data-detached="true"]')], "block");
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    return false;
};

export const avContextmenu = (protyle: IProtyle, rowElement: HTMLElement, position: IPosition) => {
    if (rowElement.classList.contains("av__row--header")) {
        return false;
    }
    const blockElement = hasClosestBlock(rowElement);
    if (!blockElement) {
        return false;
    }
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
    const rowIds: string[] = [];
    const blockIds: string[] = [];
    const rowElements = blockElement.querySelectorAll(".av__row--select:not(.av__row--header)");
    rowElements.forEach(item => {
        rowIds.push(item.getAttribute("data-id"));
        blockIds.push(item.querySelector(".av__cell[data-block-id]").getAttribute("data-block-id"));
    });
    updateHeader(rowElement);
    menu.addItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        click() {
            const avID = blockElement.getAttribute("data-av-id");
            const undoOperations: IOperation[] = [];
            rowElements.forEach(item => {
                undoOperations.push({
                    action: "insertAttrViewBlock",
                    avID,
                    previousID: item.previousElementSibling?.getAttribute("data-id") || "",
                    srcIDs: [item.getAttribute("data-id")],
                    isDetached: item.querySelector('.av__cell[data-detached="true"]') ? true : false,
                });
            });
            transaction(protyle, [{
                action: "removeAttrViewBlock",
                srcIDs: blockIds,
                avID,
            }], undoOperations);
            rowElements.forEach(item => {
                item.remove();
            });
            updateHeader(blockElement.querySelector(".av__row"));
        }
    });
    if (rowIds.length === 1) {
        menu.addSeparator();
        openEditorTab(protyle.app, rowIds[0]);
        menu.addItem({
            label: window.siyuan.languages.copy,
            icon: "iconCopy",
            type: "submenu",
            submenu: copySubMenu(rowIds[0])
        });
    }
    menu.addSeparator();
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
    blockElement.querySelector(".layout-tab-bar .item__text").textContent = newData;

    // 当前页面不能进行推送，否则光标会乱跳
    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${avId}"]`)).forEach((item: HTMLElement) => {
        if(blockElement.isSameNode(item)) {
            return;
        }
        const titleElement = item.querySelector(".av__title") as HTMLElement;
        if (!titleElement) {
            return;
        }
        titleElement.textContent = newData;
        titleElement.dataset.title = newData;
        item.querySelector(".layout-tab-bar .item__text").textContent = newData;
    });
};

export const updateAttrViewCellAnimation = (cellElement: HTMLElement) => {
    cellElement.style.opacity = "0.38";
    cellElement.style.backgroundColor = "var(--b3-theme-surface-light)";
};

export const removeAttrViewColAnimation = (blockElement: Element, id: string) => {
    blockElement.querySelectorAll(`.av__cell[data-col-id="${id}"]`).forEach(item => {
        item.remove();
    });
};
