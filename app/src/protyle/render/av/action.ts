import {Menu} from "../../../plugin/Menu";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";
import {transaction} from "../../wysiwyg/transaction";
import {openEditorTab} from "../../../menus/util";
import {copySubMenu} from "../../../menus/commonMenuItem";
import {openCalcMenu, popTextCell} from "./cell";
import {getColIconByType, showColMenu, updateHeader} from "./col";
import {emitOpenMenu} from "../../../plugin/EventBus";
import {addCol} from "./addCol";
import {openMenuPanel} from "./openMenuPanel";
import {hintRef} from "../../hint/extend";
import {focusByRange} from "../../util/selection";
import {writeText} from "../../util/compatibility";
import {showMessage} from "../../../dialog/message";
import {previewImage} from "../../preview/image";

export const avClick = (protyle: IProtyle, event: MouseEvent & { target: HTMLElement }) => {
    const blockElement = hasClosestBlock(event.target);
    if (!blockElement) {
        return false;
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
        window.open(linkAddress);
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
        cellElement.parentElement.parentElement.querySelectorAll(".av__row--select").forEach(item => {
            item.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconUncheck");
            item.classList.remove("av__row--select");
        });
        popTextCell(protyle, [cellElement]);
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
    const rowElements = blockElement.querySelectorAll(".av__row--select:not(.av__row--header)");
    rowElements.forEach(item => {
        rowIds.push(item.getAttribute("data-id"));
        blockIds.push(item.querySelector(".av__cell").getAttribute("data-block-id"));
    });
    updateHeader(rowElement);
    menu.addItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        click() {
            const previousElement = rowElements[0].previousElementSibling as HTMLElement;
            transaction(protyle, [{
                action: "removeAttrViewBlock",
                srcIDs: blockIds,
                avID: blockElement.getAttribute("data-av-id"),
            }], [{
                action: "insertAttrViewBlock",
                avID: blockElement.getAttribute("data-av-id"),
                previousID: previousElement?.getAttribute("data-id") || "",
                srcIDs: rowIds,
            }]);
            rowElements.forEach(item => {
                item.remove();
            });
            updateHeader(previousElement);
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
        let hideBlock = false
        const selectElements: HTMLElement[] = Array.from(blockElement.querySelectorAll(`.av__row--select:not(.av__row--header) .av__cell[data-col-id="${cellElement.dataset.colId}"]`))
        if (cellElement.dataset.dtype === "block") {
            selectElements.find(item => {
                if (!item.dataset.detached) {
                    hideBlock = true;
                    return true;
                }
            })
        }
        if (!hideBlock) {
            editAttrSubmenu.push({
                icon: getColIconByType(cellElement.getAttribute("data-dtype") as TAVCol),
                label: cellElement.textContent.trim(),
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
        action: "setAttrViewName",
        id: avId,
        data: nameElement.textContent.trim(),
    }], [{
        action: "setAttrViewName",
        id: avId,
        name: nameElement.dataset.title,
    }]);
    nameElement.dataset.title = nameElement.textContent.trim();
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

export const insertAttrViewBlockAnimation = (blockElement: Element, size: number, previousId: string, avId?: string) => {
    const previousElement = blockElement.querySelector(`.av__row[data-id="${previousId}"]`) || blockElement.querySelector(".av__row--header");
    let colHTML = "";
    previousElement.querySelectorAll(".av__cell").forEach((item: HTMLElement) => {
        colHTML += `<div class="av__cell" style="width: ${item.style.width}" ${item.getAttribute("data-block-id") ? ' data-detached="true"' : ""}><span class="av__pulse"></span></div>`;
    });

    let html = "";
    new Array(size).fill(1).forEach(() => {
        html += `<div class="av__row" data-avid="${avId}">
    <div style="width: 24px"></div>
    ${colHTML}
</div>`;
    });
    previousElement.insertAdjacentHTML("afterend", html);
};
