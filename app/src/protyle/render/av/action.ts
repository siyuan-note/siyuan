import {Menu} from "../../../plugin/Menu";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {transaction} from "../../wysiwyg/transaction";
import {openEditorTab} from "../../../menus/util";
import {openFileAttr} from "../../../menus/commonMenuItem";
import {
    addDragFill,
    cellValueIsEmpty,
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
import {previewAttrViewImages} from "../../preview/image";
import {openEmojiPanel, unicode2Emoji} from "../../../emoji";
import * as dayjs from "dayjs";
import {openCalcMenu} from "./calc";
import {avRender} from "./render";
import {addView, openViewMenu} from "./view";
import {isOnlyMeta, writeText} from "../../util/compatibility";
import {openSearchAV} from "./relation";
import {Constants} from "../../../constants";
import {hideElements} from "../../ui/hideElements";
import {fetchPost, fetchSyncPost} from "../../../util/fetch";
import {scrollCenter} from "../../../util/highlightById";
import {escapeHtml} from "../../../util/escape";
import {editGalleryItem, openGalleryItemMenu} from "./gallery/util";
import {clearSelect} from "../../util/clear";
import {removeCompressURL} from "../../../util/image";

let foldTimeout: number;
export const avClick = (protyle: IProtyle, event: MouseEvent & { target: HTMLElement }) => {
    if (isOnlyMeta(event)) {
        return false;
    }
    const blockElement = hasClosestBlock(event.target);
    if (!blockElement) {
        return false;
    }

    const viewType = blockElement.getAttribute("data-av-type") as TAVView;
    let target = event.target;
    while (target && !target.isEqualNode(blockElement)) {
        const type = target.getAttribute("data-type");
        if (type === "av-header-add" && !protyle.disabled) {
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
        } else if (type === "av-header-more" && !protyle.disabled) {
            openMenuPanel({protyle, blockElement, type: "properties"});
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-add-more" && !protyle.disabled) {
            insertRows({
                blockElement,
                protyle,
                count: 1,
                previousID: "",
                groupID: blockElement.querySelector(".av__body")?.getAttribute("data-group-id") || ""
            });
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-more" && !protyle.disabled) {
            openMenuPanel({protyle, blockElement, type: "config"});
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-switcher" && !protyle.disabled) {
            openMenuPanel({protyle, blockElement, type: "switcher"});
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-sort" && !protyle.disabled) {
            openMenuPanel({protyle, blockElement, type: "sorts"});
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-filter" && !protyle.disabled) {
            openMenuPanel({protyle, blockElement, type: "filters"});
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-add" && !protyle.disabled) {
            addView(protyle, blockElement);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "block-more" && !protyle.disabled) {
            window.siyuan.menus.menu.remove();
            protyle.toolbar.range = document.createRange();
            protyle.toolbar.range.selectNodeContents(target);
            focusByRange(protyle.toolbar.range);
            if (viewType === "table") {
                target.parentElement.classList.add("av__cell--select");
                addDragFill(target.parentElement);
            }
            hintRef(target.previousElementSibling.textContent.trim(), protyle, "av");
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "set-page-size" && !protyle.disabled) {
            setPageSize({
                target,
                protyle,
                avID: blockElement.getAttribute("data-av-id"),
                nodeElement: blockElement
            });
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-add-bottom" && !protyle.disabled) {
            const bodyElement = hasClosestByClassName(target, "av__body");
            insertRows({
                blockElement, protyle,
                count: 1,
                previousID: (bodyElement && bodyElement.querySelector(".av__row--util")?.previousElementSibling?.getAttribute("data-id")) ||
                    target.previousElementSibling?.getAttribute("data-id") || undefined,
                groupID: bodyElement ? bodyElement.getAttribute("data-group-id") : ""
            });
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-add-top" && !protyle.disabled) {
            const titleElement = hasClosestByClassName(target, "av__group-title");
            insertRows({
                blockElement,
                protyle,
                count: 1,
                previousID: "",
                groupID: titleElement ? titleElement.nextElementSibling.getAttribute("data-group-id") : ""
            });
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__cell--header") && !protyle.disabled) {
            showColMenu(protyle, blockElement, target);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__cell") && !protyle.disabled) {
            if (!hasClosestByClassName(target, "av__row--header")) {
                if (target.querySelector(".av__pulse")) {
                    return;
                }
                const cellType = getTypeByCellElement(target);
                if (viewType === "table") {
                    const scrollElement = hasClosestByClassName(target, "av__scroll");
                    if (!scrollElement) {
                        return;
                    }
                    const rowElement = hasClosestByClassName(target, "av__row");
                    if (!rowElement) {
                        return;
                    }
                    if (cellType === "updated" || cellType === "created" || cellType === "lineNumber") {
                        selectRow(rowElement.querySelector(".av__firstcol"), "toggle");
                    } else {
                        scrollElement.querySelectorAll(".av__row--select").forEach(item => {
                            item.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconUncheck");
                            item.classList.remove("av__row--select");
                        });
                        updateHeader(rowElement);
                        popTextCell(protyle, [target]);
                    }
                } else {
                    const itemElement = hasClosestByClassName(target, "av__gallery-item");
                    if (itemElement && cellType !== "updated" && cellType !== "created" && cellType !== "lineNumber") {
                        popTextCell(protyle, [target]);
                    }
                }
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__calc") && !protyle.disabled) {
            openCalcMenu(protyle, target, undefined, event.clientX - 64);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("b3-menu__avemoji") && !protyle.disabled) {
            const rect = target.getBoundingClientRect();
            openEmojiPanel(target.nextElementSibling.getAttribute("data-id"), "doc", {
                x: rect.left,
                y: rect.bottom,
                h: rect.height,
                w: rect.width,
            }, (unicode) => {
                target.innerHTML = unicode2Emoji(unicode || window.siyuan.storage[Constants.LOCAL_IMAGES].file);
            }, target.querySelector("img"));
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-gallery-edit" && !protyle.disabled) {
            editGalleryItem(target);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-gallery-more" && !protyle.disabled) {
            const rect = target.getBoundingClientRect();
            openGalleryItemMenu({
                target,
                protyle,
                position: {
                    x: rect.left,
                    y: rect.bottom
                }
            });
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-group-fold") {
            target.setAttribute("data-processed", "true");
            const isOpen = target.firstElementChild.classList.contains("av__group-arrow--open");
            if (isOpen) {
                target.firstElementChild.classList.remove("av__group-arrow--open");
                target.parentElement.nextElementSibling.classList.add("fn__none");
            } else {
                target.firstElementChild.classList.add("av__group-arrow--open");
                target.parentElement.nextElementSibling.classList.remove("fn__none");
            }
            clearTimeout(foldTimeout);
            foldTimeout = window.setTimeout(() => {
                transaction(protyle, [{
                    action: "foldAttrViewGroup",
                    avID: blockElement.dataset.avId,
                    blockID: blockElement.dataset.nodeId,
                    id: target.dataset.id,
                    data: isOpen
                }], [{
                    action: "foldAttrViewGroup",
                    avID: blockElement.dataset.avId,
                    blockID: blockElement.dataset.nodeId,
                    id: target.dataset.id,
                    data: !isOpen
                }]);
            }, Constants.TIMEOUT_COUNT);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-load-more") {
            blockElement.querySelectorAll(".av__row--footer").forEach((item: HTMLElement) => {
                item.style.transform = "";
            });
            blockElement.removeAttribute("data-render");
            const bodyElement = hasClosestByClassName(target, "av__body") as HTMLElement;
            bodyElement.dataset.pageSize = (parseInt(bodyElement.dataset.pageSize) + parseInt(bodyElement.querySelector('[data-type="set-page-size"]').getAttribute("data-size"))).toString();
            avRender(blockElement, protyle);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__firstcol")) {
            window.siyuan.menus.menu.remove();
            selectRow(target, "toggle");
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("item") && target.parentElement.classList.contains("layout-tab-bar")) {
            if (target.classList.contains("item--focus")) {
                openViewMenu({protyle, blockElement, element: target});
            } else {
                transaction(protyle, [{
                    action: "setAttrViewBlockView",
                    blockID: blockElement.getAttribute("data-node-id"),
                    id: target.dataset.id,
                    avID: blockElement.getAttribute("data-av-id"),
                }], [{
                    action: "setAttrViewBlockView",
                    blockID: blockElement.getAttribute("data-node-id"),
                    id: target.parentElement.querySelector(".item--focus").getAttribute("data-id"),
                    avID: blockElement.getAttribute("data-av-id"),
                }]);
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__cellassetimg")) {
            previewAttrViewImages(
                removeCompressURL((target as HTMLImageElement).getAttribute("src")),
                blockElement.getAttribute("data-av-id"),
                blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW),
                (blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement)?.value.trim() || ""
            );
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__row") && event.shiftKey && !target.classList.contains("av__row--header")) {
            selectRow(target.querySelector(".av__firstcol"), "toggle");
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "copy") {
            writeText(getCellText(hasClosestByClassName(target, "av__cell")));
            showMessage(window.siyuan.languages.copied);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-search-icon") {
            const searchElement = blockElement.querySelector('input[data-type="av-search"]') as HTMLInputElement;
            searchElement.style.width = "128px";
            searchElement.style.paddingLeft = "";
            searchElement.style.paddingRight = "";
            const viewsElement = hasClosestByClassName(searchElement, "av__views");
            if (viewsElement) {
                viewsElement.classList.add("av__views--show");
            }
            setTimeout(() => {
                searchElement.focus();
            }, Constants.TIMEOUT_TRANSITION);
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
    const avType = blockElement.getAttribute("data-av-type") as TAVView;
    if (avType === "table") {
        if (!rowElement.classList.contains("av__row--select")) {
            clearSelect(["row"], blockElement);
        }
        clearSelect(["cell"], blockElement);
        rowElement.classList.add("av__row--select");
        rowElement.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconCheck");
        updateHeader(rowElement);
    } else {
        if (!rowElement.classList.contains("av__gallery-item--select")) {
            clearSelect(["galleryItem"], blockElement);
        }
        rowElement.classList.add("av__gallery-item--select");
    }
    const menu = new Menu();
    const rowElements = blockElement.querySelectorAll(".av__row--select:not(.av__row--header), .av__gallery-item--select");
    const keyCellElement = rowElements[0].querySelector('.av__cell[data-dtype="block"]') as HTMLElement;
    const ids = Array.from(rowElements).map(item => item.querySelector('[data-dtype="block"] .av__celltext').getAttribute("data-id"));
    if (rowElements.length === 1 && keyCellElement.getAttribute("data-detached") !== "true") {
        /// #if !MOBILE
        const blockId = ids[0];
        const openSubmenus = openEditorTab(protyle.app, [blockId], undefined, undefined, true);
        openSubmenus.push({id: "separator_3", type: "separator"});
        openSubmenus.push({
            id: "attr",
            icon: "iconAttr",
            label: window.siyuan.languages.attr,
            click: () => {
                fetchPost("/api/attr/getBlockAttrs", {id: blockId}, (response) => {
                    openFileAttr(response.data, "av", protyle);
                });
            }
        });
        menu.addItem({
            id: "openBy",
            label: window.siyuan.languages.openBy,
            icon: "iconOpen",
            submenu: openSubmenus,
        });
        /// #endif
    }
    let hasBlock = false;
    rowElements.forEach((item) => {
        if (item.querySelector('.av__cell[data-dtype="block"]').getAttribute("data-detached") !== "true") {
            hasBlock = true;
        }
    });
    const copyMenu: IMenu[] = [{
        id: "copyKeyContent",
        iconHTML: "",
        label: window.siyuan.languages.copyKeyContent,
        click() {
            let text = "";
            rowElements.forEach((item, i) => {
                if (rowElements.length > 1) {
                    text += "- ";
                }
                text += item.querySelector('.av__cell[data-dtype="block"] .av__celltext').textContent.trim();
                if (ids.length > 1 && i !== ids.length - 1) {
                    text += "\n";
                }
            });
            writeText(text);
        }
    }];
    if (hasBlock) {
        copyMenu.splice(1, 0, {
            id: "copyBlockRef",
            iconHTML: "",
            label: window.siyuan.languages.copyBlockRef,
            click: () => {
                let text = "";
                for (let i = 0; i < ids.length; i++) {
                    const id = ids[i];
                    let content = "";
                    const cellElement = rowElements[i].querySelector(".av__cell[data-dtype='block']");
                    if (cellElement.getAttribute("data-detached") === "true") {
                        content = cellElement.querySelector(".av__celltext").textContent;
                    } else {
                        content = `((${id} '${cellElement.querySelector(".av__celltext").textContent.replace(/[\n]+/g, " ")}'))`;
                    }
                    if (ids.length > 1) {
                        text += "- ";
                    }
                    text += content;
                    if (ids.length > 1 && i !== ids.length - 1) {
                        text += "\n";
                    }
                }
                writeText(text);
            }
        }, {
            id: "copyBlockEmbed",
            iconHTML: "",
            label: window.siyuan.languages.copyBlockEmbed,
            click: () => {
                let text = "";
                ids.forEach((id, index) => {
                    if (ids.length > 1) {
                        text += "- ";
                    }
                    const cellElement = rowElements[index].querySelector(".av__cell[data-dtype='block']");
                    if (cellElement.getAttribute("data-detached") === "true") {
                        text += cellElement.querySelector(".av__celltext").textContent;
                    } else {
                        text += `{{select * from blocks where id='${id}'}}`;
                    }
                    if (ids.length > 1 && index !== ids.length - 1) {
                        text += "\n";
                    }
                });
                writeText(text);
            }
        }, {
            id: "copyProtocol",
            iconHTML: "",
            label: window.siyuan.languages.copyProtocol,
            click: () => {
                let text = "";
                ids.forEach((id, index) => {
                    if (ids.length > 1) {
                        text += "- ";
                    }
                    const cellElement = rowElements[index].querySelector(".av__cell[data-dtype='block']");
                    if (cellElement.getAttribute("data-detached") === "true") {
                        text += cellElement.querySelector(".av__celltext").textContent;
                    } else {
                        text += `siyuan://blocks/${id}`;
                    }
                    if (ids.length > 1 && index !== ids.length - 1) {
                        text += "\n";
                    }
                });
                writeText(text);
            }
        }, {
            id: "copyProtocolInMd",
            iconHTML: "",
            label: window.siyuan.languages.copyProtocolInMd,
            click: () => {
                let text = "";
                for (let i = 0; i < ids.length; i++) {
                    const id = ids[i];
                    let content = "";
                    const cellElement = rowElements[i].querySelector(".av__cell[data-dtype='block']");
                    if (cellElement.getAttribute("data-detached") === "true") {
                        content = cellElement.querySelector(".av__celltext").textContent;
                    } else {
                        content = `[${cellElement.querySelector(".av__celltext").textContent.replace(/[\n]+/g, " ")}](siyuan://blocks/${id})`;
                    }
                    if (ids.length > 1) {
                        text += "- ";
                    }
                    text += content;
                    if (ids.length > 1 && i !== ids.length - 1) {
                        text += "\n";
                    }
                }
                writeText(text);
            }
        }, {
            id: "copyHPath",
            iconHTML: "",
            label: window.siyuan.languages.copyHPath,
            click: async () => {
                let text = "";
                for (let i = 0; i < ids.length; i++) {
                    const id = ids[i];
                    let content = "";
                    const cellElement = rowElements[i].querySelector(".av__cell[data-dtype='block']");
                    if (cellElement.getAttribute("data-detached") === "true") {
                        content = cellElement.querySelector(".av__celltext").textContent;
                    } else {
                        const response = await fetchSyncPost("/api/filetree/getHPathByID", {id});
                        content = response.data;
                    }

                    if (ids.length > 1) {
                        text += "- ";
                    }
                    text += content;
                    if (ids.length > 1 && i !== ids.length - 1) {
                        text += "\n";
                    }
                }
                writeText(text);
            }
        }, {
            id: "copyID",
            iconHTML: "",
            label: window.siyuan.languages.copyID,
            click: () => {
                let text = "";
                ids.forEach((id, index) => {
                    if (ids.length > 1) {
                        text += "- ";
                    }
                    const cellElement = rowElements[index].querySelector(".av__cell[data-dtype='block']");
                    if (cellElement.getAttribute("data-detached") === "true") {
                        text += cellElement.querySelector(".av__celltext").textContent;
                    } else {
                        text += id;
                    }
                    if (ids.length > 1 && index !== ids.length - 1) {
                        text += "\n";
                    }
                });
                writeText(text);
            }
        });
    }

    menu.addItem({
        id: "copy",
        label: window.siyuan.languages.copy,
        icon: "iconCopy",
        type: "submenu",
        submenu: copyMenu
    });
    if (!protyle.disabled) {
        menu.addItem({
            id: "addToDatabase",
            label: window.siyuan.languages.addToDatabase,
            icon: "iconDatabase",
            click() {
                openSearchAV(blockElement.getAttribute("data-av-id"), rowElements[0] as HTMLElement, (listItemElement) => {
                    const srcs: IOperationSrcs[] = [];
                    const sourceIds: string[] = [];
                    rowElements.forEach(item => {
                        const rowId = item.getAttribute("data-id");
                        const blockValue = genCellValueByElement("block", item.querySelector('.av__cell[data-dtype="block"]'));
                        srcs.push({
                            itemID: Lute.NewNodeID(),
                            content: blockValue.block.content,
                            id: blockValue.block.id || "",
                            isDetached: blockValue.isDetached,
                        });
                        sourceIds.push(rowId);
                    });
                    const avID = listItemElement.dataset.avId;
                    const viewID = listItemElement.dataset.viewId;
                    transaction(protyle, [{
                        action: "insertAttrViewBlock",
                        ignoreDefaultFill: viewID ? false : true,
                        viewID,
                        avID,
                        srcs,
                        context: {ignoreTip: "true"},
                        blockID: listItemElement.dataset.blockId,
                        groupID: rowElement.parentElement.getAttribute("data-group-id")
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
                menu.addSeparator({id: "separator_1"});
            }
            menu.addItem({
                id: avType === "table" ? "insertRowBefore" : "insertItemBefore",
                icon: "iconBefore",
                label: `<div class="fn__flex" style="align-items: center;">
${window.siyuan.languages[avType === "table" ? "insertRowBefore" : "insertItemBefore"].replace("${x}", `<span class="fn__space"></span><input style="width:64px" type="number" step="1" min="1" value="1" placeholder="${window.siyuan.languages.enterKey}" class="b3-text-field"><span class="fn__space"></span>`)}
</div>`,
                bind(element) {
                    const inputElement = element.querySelector("input");
                    element.addEventListener("click", () => {
                        if (document.activeElement === inputElement) {
                            return;
                        }
                        insertRows({
                            blockElement,
                            protyle,
                            count: parseInt(inputElement.value),
                            previousID: rowElements[0].previousElementSibling?.getAttribute("data-id"),
                            groupID: rowElements[0].parentElement.getAttribute("data-group-id")
                        });
                        menu.close();
                    });
                    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                        if (!event.isComposing && event.key === "Enter") {
                            insertRows({
                                blockElement,
                                protyle,
                                count: parseInt(inputElement.value),
                                previousID: rowElements[0].previousElementSibling?.getAttribute("data-id"),
                                groupID: rowElements[0].parentElement.getAttribute("data-group-id")
                            });
                            menu.close();
                        }
                    });
                }
            });
            menu.addItem({
                id: avType === "table" ? "insertRowAfter" : "insertItemAfter",
                icon: "iconAfter",
                label: `<div class="fn__flex" style="align-items: center;">
${window.siyuan.languages[avType === "table" ? "insertRowAfter" : "insertItemAfter"].replace("${x}", `<span class="fn__space"></span><input style="width:64px" type="number" step="1" min="1" placeholder="${window.siyuan.languages.enterKey}" class="b3-text-field" value="1"><span class="fn__space"></span>`)}
</div>`,
                bind(element) {
                    const inputElement = element.querySelector("input");
                    element.addEventListener("click", () => {
                        if (document.activeElement === inputElement) {
                            return;
                        }
                        insertRows({
                            blockElement,
                            protyle,
                            count: parseInt(inputElement.value),
                            previousID: rowElements[0].getAttribute("data-id"),
                            groupID: rowElements[0].parentElement.getAttribute("data-group-id")
                        });
                        menu.close();
                    });
                    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                        if (!event.isComposing && event.key === "Enter") {
                            insertRows({
                                blockElement,
                                protyle,
                                count: parseInt(inputElement.value),
                                previousID: rowElements[0].getAttribute("data-id"),
                                groupID: rowElements[0].parentElement.getAttribute("data-group-id")
                            });
                            menu.close();
                        }
                    });
                }
            });
            menu.addSeparator({id: "separator_2"});
            if (keyCellElement.getAttribute("data-detached") !== "true") {
                menu.addItem({
                    id: "unbindBlock",
                    label: window.siyuan.languages.unbindBlock,
                    icon: "iconLinkOff",
                    click() {
                        updateCellsValue(protyle, blockElement, {
                            content: keyCellElement.querySelector(".av__celltext").textContent,
                        }, [keyCellElement]);
                    }
                });
            }
        }
        menu.addItem({
            id: "delete",
            icon: "iconTrashcan",
            label: window.siyuan.languages.delete,
            click() {
                deleteRow(blockElement, protyle);
            }
        });
        const editAttrSubmenu: IMenu[] = [];
        if (avType === "table") {
            rowElement.parentElement.querySelectorAll(".av__row--header .av__cell").forEach((cellElement: HTMLElement) => {
                const selectElements: HTMLElement[] = Array.from(blockElement.querySelectorAll(`.av__row--select:not(.av__row--header) .av__cell[data-col-id="${cellElement.dataset.colId}"]`));
                const type = cellElement.getAttribute("data-dtype") as TAVCol;
                if (!["updated", "created"].includes(type)) {
                    const icon = cellElement.dataset.icon;
                    editAttrSubmenu.push({
                        iconHTML: icon ? unicode2Emoji(icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(type)}"></use></svg>`,
                        label: escapeHtml(cellElement.querySelector(".av__celltext").textContent.trim()),
                        click() {
                            popTextCell(protyle, selectElements);
                        }
                    });
                }
            });
        } else {
            rowElement.querySelectorAll(".av__cell").forEach((cellElement: HTMLElement) => {
                const selectElements: HTMLElement[] = Array.from(blockElement.querySelectorAll(`.av__gallery-item--select .av__cell[data-field-id="${cellElement.dataset.fieldId}"]`));
                const type = cellElement.getAttribute("data-dtype") as TAVCol;
                if (!["updated", "created"].includes(type)) {
                    const iconElement = cellElement.parentElement.querySelector(".av__gallery-tip, .av__gallery-name").firstElementChild.cloneNode(true) as HTMLElement;
                    iconElement.classList.add("b3-menu__icon");
                    editAttrSubmenu.push({
                        iconHTML: iconElement.outerHTML,
                        label: escapeHtml(cellElement.getAttribute("aria-label").split('<div class="ft__on-surface">')[0]),
                        click() {
                            rowElement.querySelector(".av__gallery-fields").classList.add("av__gallery-fields--edit");
                            rowElement.querySelector('[data-type="av-gallery-edit"]').setAttribute("aria-label", window.siyuan.languages.hideEmptyFields);
                            popTextCell(protyle, selectElements);
                        }
                    });
                }
            });
        }
        menu.addItem({
            id: "fields",
            icon: "iconAttr",
            label: window.siyuan.languages.fields,
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
    // https://github.com/siyuan-note/siyuan/issues/14770
    if (nameElement.textContent === "") {
        nameElement.querySelectorAll("br").forEach(item => {
            item.remove();
        });
    }
    const newData = nameElement.textContent.trim();
    if (newData === nameElement.dataset.title.trim()) {
        return;
    }
    if (newData.length > Constants.SIZE_TITLE) {
        showMessage(window.siyuan.languages["_kernel"]["106"]);
        return false;
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
    Array.from(protyle.wysiwyg.element.querySelectorAll(`.av[data-av-id="${avId}"]`)).forEach((item: HTMLElement) => {
        if (blockElement === item) {
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
        const blockElement = hasClosestBlock(cellElement);
        if (!blockElement) {
            return;
        }
        const viewType = blockElement.getAttribute("data-av-type") as TAVView;
        const iconElement = cellElement.querySelector(".b3-menu__avemoji");
        if (["gallery", "kanban"].includes(viewType)) {
            if (value.type === "checkbox") {
                value.checkbox = {
                    checked: value.checkbox?.checked || false,
                    content: cellElement.getAttribute("aria-label").split('<div class="ft__on-surface">')[0],
                };
            }
            cellElement.innerHTML = renderCell(value, 0, iconElement ? !iconElement.classList.contains("fn__none") : false, viewType);
            cellElement.parentElement.setAttribute("data-empty", cellValueIsEmpty(value).toString());
        } else {
            cellElement.innerHTML = renderCell(value, 0, iconElement ? !iconElement.classList.contains("fn__none") : false);
        }
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

export const duplicateCompletely = (protyle: IProtyle, nodeElement: HTMLElement) => {
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
