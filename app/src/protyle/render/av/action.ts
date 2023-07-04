import {Menu} from "../../../plugin/Menu";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";
import {transaction} from "../../wysiwyg/transaction";
import {openEditorTab} from "../../../menus/util";
import {copySubMenu} from "../../../menus/commonMenuItem";
import {popTextCell, showHeaderCellMenu} from "./cell";
import {getColIconByType, updateHeader} from "./col";
import {emitOpenMenu} from "../../../plugin/EventBus";
import {addCol} from "./addCol";
import {openMenuPanel} from "./openMenuPanel";

export const avClick = (protyle: IProtyle, event: MouseEvent & { target: HTMLElement }) => {
    const blockElement = hasClosestBlock(event.target);
    if (!blockElement) {
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
        avContextmenu(protyle, event, gutterElement);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const checkElement = hasClosestByClassName(event.target, "av__firstcol");
    if (checkElement) {
        window.siyuan.menus.menu.remove();
        const rowElement = checkElement.parentElement;
        const useElement = checkElement.querySelector("use");
        if (rowElement.classList.contains("av__row--header")) {
            if ("#iconCheck" === useElement.getAttribute("xlink:href")) {
                rowElement.parentElement.querySelectorAll(".av__firstcol").forEach(item => {
                    item.querySelector("use").setAttribute("xlink:href", "#iconUncheck");
                    item.parentElement.classList.remove("av__row--select");
                });
            } else {
                rowElement.parentElement.querySelectorAll(".av__firstcol").forEach(item => {
                    item.querySelector("use").setAttribute("xlink:href", "#iconCheck");
                    item.parentElement.classList.add("av__row--select");
                });
            }
        } else {
            if (useElement.getAttribute("xlink:href") === "#iconUncheck") {
                checkElement.parentElement.classList.add("av__row--select");
                useElement.setAttribute("xlink:href", "#iconCheck");
            } else {
                checkElement.parentElement.classList.remove("av__row--select");
                useElement.setAttribute("xlink:href", "#iconUncheck");
            }
        }
        updateHeader(rowElement);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const headerMoreElement = hasClosestByAttribute(event.target, "data-type", "av-header-more");
    if (headerMoreElement) {
        openMenuPanel(protyle, blockElement, "properties");
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const moreElement = hasClosestByAttribute(event.target, "data-type", "av-more");
    if (moreElement) {
        openMenuPanel(protyle, blockElement, "config");
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const sortsElement = hasClosestByAttribute(event.target, "data-type", "av-sort");
    if (sortsElement) {
        openMenuPanel(protyle, blockElement, "sorts");
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const cellHeaderElement = hasClosestByClassName(event.target, "av__cellheader");
    if (cellHeaderElement) {
        showHeaderCellMenu(protyle, blockElement, cellHeaderElement.parentElement);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const cellElement = hasClosestByClassName(event.target, "av__cell");
    if (cellElement && !cellElement.parentElement.classList.contains("av__row--header")) {
        popTextCell(protyle, cellElement);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    return false;
};

export const avContextmenu = (protyle: IProtyle, event: MouseEvent & { detail: any }, target: HTMLElement) => {
    const rowElement = hasClosestByClassName(target, "av__row");
    if (!rowElement) {
        return false;
    }
    if (rowElement.classList.contains("av__row--header")) {
        return false;
    }
    const blockElement = hasClosestBlock(rowElement);
    if (!blockElement) {
        return false;
    }
    event.preventDefault();
    event.stopPropagation();

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
    blockElement.querySelectorAll(".av__row--select:not(.av__row--header )").forEach(item => {
        rowIds.push(item.getAttribute("data-id"));
        blockIds.push(item.querySelector(".av__cell").getAttribute("data-block-id"));
    });
    updateHeader(rowElement);
    menu.addItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        click() {
            transaction(protyle, [{
                action: "removeAttrViewBlock",
                srcIDs: blockIds,
                parentID: blockElement.getAttribute("data-av-id"),
            }], [{
                action: "insertAttrViewBlock",
                parentID: blockElement.getAttribute("data-av-id"),
                previousID: rowElement.previousElementSibling?.getAttribute("data-id") || "",
                srcIDs: rowIds,
            }]);
            rowElement.remove();
        }
    });
    menu.addItem({
        icon: "iconCopy",
        label: window.siyuan.languages.duplicate,
        click() {

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
    if (rowIds.length === 1) {
        menu.addItem({
            icon: "iconEdit",
            label: window.siyuan.languages.edit,
            click() {

            }
        });
    }
    const editAttrSubmenu: IMenu[] = [];
    rowElement.parentElement.querySelectorAll(".av__row--header .av__cell").forEach((cellElement) => {
        editAttrSubmenu.push({
            icon: getColIconByType(cellElement.getAttribute("data-dtype") as TAVCol),
            label: cellElement.textContent.trim(),
            click() {
            }
        });
    });
    menu.addItem({
        icon: "iconList",
        label: window.siyuan.languages.attr,
        type: "submenu",
        submenu: editAttrSubmenu
    });
    menu.addItem({
        icon: "iconMove",
        label: window.siyuan.languages.move,
        click() {

        }
    });
    if (protyle?.app?.plugins) {
        emitOpenMenu({
            plugins: protyle.app.plugins,
            type: "open-menu-av",
            detail: {
                protyle,
                element: hasClosestByClassName(target, "av__cell"),
            },
            separatorPosition: "top",
        });
    }
    menu.open({
        x: event.clientX,
        y: event.clientY,
    });
    return true;
};

export const updateAVName = (protyle: IProtyle, blockElement: Element) => {
    const avId = blockElement.getAttribute("data-av-id");
    const nameElement = blockElement.querySelector(".av__title") as HTMLElement;
    if (nameElement.textContent.trim() === nameElement.dataset.title.trim()) {
        return;
    }
    transaction(protyle, [{
        action: "setAttrView",
        id: avId,
        data: {
            name: nameElement.textContent.trim(),
        }
    }], [{
        action: "setAttrView",
        id: avId,
        data: {
            name: nameElement.dataset.title,
        }
    }]);
    nameElement.dataset.title = nameElement.textContent.trim();
};
