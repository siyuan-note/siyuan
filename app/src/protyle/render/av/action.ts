import {Menu} from "../../../plugin/Menu";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";
import {transaction} from "../../wysiwyg/transaction";
import {openEditorTab} from "../../../menus/util";
import {copySubMenu} from "../../../menus/commonMenuItem";
import {getTypeByCellElement, popTextCell} from "./cell";
import {getColIconByType, showColMenu} from "./col";
import {insertAttrViewBlockAnimation, setPageSize, stickyRow, updateHeader} from "./row";
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
import {openCalcMenu} from "./calc";
import {avRender} from "./render";
import {addView, openViewMenu} from "./view";

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
        const textElement = copyElement.previousElementSibling;
        if (textElement.querySelector(".av__cellicon")) {
            writeText(`${textElement.firstChild.textContent} → ${textElement.lastChild.textContent}`);
        } else {
            writeText(textElement.textContent);
        }
        showMessage(window.siyuan.languages.copied);
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
            const avID = blockElement.getAttribute("data-av-id");
            const srcIDs = [Lute.NewNodeID()];
            transaction(protyle, [{
                action: "insertAttrViewBlock",
                avID,
                srcIDs,
                isDetached: true,
            }], [{
                action: "removeAttrViewBlock",
                srcIDs,
                avID,
            }]);
            insertAttrViewBlockAnimation(blockElement, srcIDs, undefined, avID);
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
            protyle.toolbar.range = document.createRange();
            protyle.toolbar.range.selectNodeContents(target);
            focusByRange(protyle.toolbar.range);
            hintRef(target.previousElementSibling.textContent.trim(), protyle, "av");
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-load-more") {
            (blockElement.querySelector(".av__row--footer") as HTMLElement).style.transform = "";
            blockElement.removeAttribute("data-render");
            blockElement.dataset.pageSize = (parseInt(blockElement.dataset.pageSize) + parseInt(blockElement.querySelector('[data-type="set-page-size"]').getAttribute("data-size"))).toString();
            avRender(blockElement, protyle);
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
            const avID = blockElement.getAttribute("data-av-id");
            const srcIDs = [Lute.NewNodeID()];
            const previousID = blockElement.querySelector(".av__row--util").previousElementSibling.getAttribute("data-id") || "";
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
            insertAttrViewBlockAnimation(blockElement, srcIDs, previousID, avID);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__gutter")) {
            const rowElement = hasClosestByClassName(target, "av__row");
            if (!rowElement) {
                return;
            }
            if (target.dataset.action === "add") {
                const avID = blockElement.getAttribute("data-av-id");
                const srcIDs = [Lute.NewNodeID()];
                const previousID = event.altKey ? (rowElement.previousElementSibling.getAttribute("data-id") || "") : rowElement.getAttribute("data-id");
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
                insertAttrViewBlockAnimation(blockElement, srcIDs, previousID, avID);
            } else {
                const gutterRect = target.getBoundingClientRect();
                avContextmenu(protyle, rowElement, {
                    x: gutterRect.left,
                    y: gutterRect.bottom,
                    w: gutterRect.width,
                    h: gutterRect.height
                });
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__firstcol")) {
            window.siyuan.menus.menu.remove();
            selectRow(target, "toggle");
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__celltext--url")) {
            let linkAddress = target.textContent.trim();
            if (target.dataset.type === "phone") {
                linkAddress = "tel:" + linkAddress;
            } else if (target.dataset.type === "email") {
                linkAddress = "mailto:" + linkAddress;
            } else if (target.classList.contains("b3-chip")) {
                linkAddress = target.dataset.url;
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
        } else if (target.classList.contains("av__cellassetimg")) {
            previewImage((target as HTMLImageElement).src);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__cellheader")) {
            showColMenu(protyle, blockElement, target.parentElement);
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
                if (type === "updated" || type === "created" || (type === "block" && !target.getAttribute("data-detached"))) {
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
        } else if (target.classList.contains("item") && target.parentElement.classList.contains("layout-tab-bar")) {
            if (target.classList.contains("item--focus")) {
                openViewMenu({protyle, blockElement, element: target});
            } else {
                blockElement.removeAttribute("data-render");
                avRender(blockElement, protyle, undefined, target.dataset.id);
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        target = target.parentElement;
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
            stickyRow(blockElement, protyle.contentElement.getBoundingClientRect(), "all");
            updateHeader(blockElement.querySelector(".av__row"));
        }
    });
    if (rowIds.length === 1 && !rowElements[0].querySelector('[data-detached="true"]')) {
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

export const updateAttrViewCellAnimation = (cellElement: HTMLElement) => {
    cellElement.style.backgroundColor = "var(--b3-av-hover)";
};

export const removeAttrViewColAnimation = (blockElement: Element, id: string) => {
    blockElement.querySelectorAll(`.av__cell[data-col-id="${id}"]`).forEach(item => {
        item.remove();
    });
};
