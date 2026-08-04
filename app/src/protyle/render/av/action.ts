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
import {addCol, getColIconByType, getColNameByType, showColMenu} from "./col";
import {deleteRow, duplicateRows, insertRows, selectRow, setPageSize, updateHeader} from "./row";
import {
    getAVPrimaryCell,
    getAVSelectedItemInfos,
    getAVSelectedItemPoints,
    getAVSelectedItems,
    resetAVRowSelect,
    updateAVRowSelect
} from "./virtualScroll";
import {emitOpenMenu} from "../../../plugin/EventBus";
import {openMenuPanel} from "./openMenuPanel";
import {hintRef} from "../../hint/extend";
import {focusBlock, focusByRange} from "../../util/selection";
import {showMessage} from "../../../dialog/message";
import {previewAttrViewImages} from "../../preview/image";
import {openEmojiPanel, unicode2Emoji} from "../../../emoji";
import * as dayjs from "dayjs";
import {openCalcMenu} from "./calc";
import {avRender, getGroupFoldTip} from "./render";
import {addView, openViewMenu} from "./view";
import {isOnlyMeta, writeText} from "../../util/compatibility";
import {selectAVItemRange, setAVItemAnchor} from "./rangeSelect";
import {openSearchAV} from "./relation";
import {Constants} from "../../../constants";
import {hideElements} from "../../ui/hideElements";
import {fetchPost, fetchSyncPost} from "../../../util/fetch";
import {scrollCenter} from "../../../util/highlightById";
import {escapeHtml} from "../../../util/escape";
import {editGalleryItem, openGalleryItemMenu} from "./gallery/util";
import {clearSelect} from "../../util/clear";
import {removeCompressURL} from "../../../util/image";
import {callMobileAppShowKeyboard} from "../../../mobile/util/mobileAppUtil";
import {createAttributeViewItem, createAttributeViewItemDocs, openNewItemTemplateMenu} from "./newItemTemplate";
import {openDatabaseRowByData} from "./openDatabaseRow";
import {openKanbanGroupMenu} from "./kanban/groupMenu";
import {getGroupFoldedStates, updateGroupFoldedStates} from "./groupFold";
import {
    finishCardCoverPosition,
    isCardCoverPositioning,
    resetCardCoverPosition,
    startCardCoverPosition
} from "./coverPosition";
import {getEditableAVFields, openAVFieldEditor, updateAVFieldValue} from "./batchEdit";
import {getAVTemplateInteractiveElement, isAVTemplateLink} from "./attributeValue";
import {isMobile} from "../../../util/functions";
import {getAVCurrentViewID} from "./viewVisibility";
import {formatAVItemLinks, genAVItemLink} from "./itemLink";

const isDetachedDatabaseCell = (cellElement: HTMLElement) => {
    return cellElement.dataset.detached === "true" || !cellElement.querySelector(".av__celltext--ref");
};

const getPrimaryRowInfo = (blockElement: HTMLElement, rowElement?: HTMLElement, itemID = rowElement?.dataset.id) => {
    const cellElement = rowElement?.querySelector('.av__cell[data-dtype="block"]') as HTMLElement;
    if (cellElement) {
        const value = genCellValueByElement("block", cellElement);
        return {
            cellElement,
            value,
            valueID: cellElement.dataset.id,
            fieldID: cellElement.dataset.fieldId || cellElement.dataset.colId,
            content: value.block?.content || "",
            blockID: value.block?.id || "",
            isDetached: isDetachedDatabaseCell(cellElement),
        };
    }
    const cell = getAVPrimaryCell(blockElement, itemID);
    if (!cell?.value) {
        return;
    }
    return {
        value: cell.value,
        valueID: cell.id,
        fieldID: cell.value.keyID,
        content: cell.value.block?.content || "",
        blockID: cell.value.block?.id || "",
        isDetached: cell.value.isDetached === true || !cell.value.block?.id,
    };
};

const unbindDatabaseRow = (protyle: IProtyle, blockElement: HTMLElement, rowID: string,
                           primaryInfo: NonNullable<ReturnType<typeof getPrimaryRowInfo>>) => {
    if (primaryInfo.cellElement) {
        updateCellsValue(protyle, blockElement, {content: primaryInfo.content}, [primaryInfo.cellElement]);
        return;
    }
    if (!primaryInfo.fieldID || !primaryInfo.valueID) {
        return;
    }
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    const value: IAVCellValue = {
        type: "block",
        id: primaryInfo.valueID,
        isDetached: true,
        block: {
            content: primaryInfo.content,
        },
    };
    transaction(protyle, [{
        action: "updateAttrViewCell",
        id: primaryInfo.valueID,
        avID: blockElement.dataset.avId,
        keyID: primaryInfo.fieldID,
        rowID,
        data: value,
    }, {
        action: "doUpdateUpdated",
        id: blockElement.dataset.nodeId,
        data: newUpdated,
    }], [{
        action: "updateAttrViewCell",
        id: primaryInfo.valueID,
        avID: blockElement.dataset.avId,
        keyID: primaryInfo.fieldID,
        rowID,
        data: primaryInfo.value,
    }, {
        action: "doUpdateUpdated",
        id: blockElement.dataset.nodeId,
        data: blockElement.getAttribute("updated"),
    }]);
    blockElement.setAttribute("updated", newUpdated);
};

const openDatabaseRow = (protyle: IProtyle, target: HTMLElement, blockElement: HTMLElement) => {
    const rowElement = hasClosestByClassName(target, "av__row") || hasClosestByClassName(target, "av__gallery-item");
    if (!rowElement) {
        return;
    }
    const primaryInfo = getPrimaryRowInfo(blockElement, rowElement as HTMLElement);
    if (!primaryInfo) {
        return;
    }
    openDatabaseRowByData(protyle, {
        avID: blockElement.dataset.avId,
        databaseBlockID: blockElement.dataset.nodeId,
        notebookID: protyle.notebookId,
        itemID: rowElement.getAttribute("data-id"),
        valueID: primaryInfo.valueID,
        title: primaryInfo.content.trim(),
        boundBlockID: primaryInfo.blockID,
        isDetached: primaryInfo.isDetached,
    });
};

const updateDatabaseRow = (protyle: IProtyle, target: HTMLElement) => {
    const cellElement = hasClosestByClassName(target, "av__cell") as HTMLElement;
    if (!cellElement) {
        return;
    }
    const textElement = cellElement.querySelector<HTMLElement>(".av__celltext");
    protyle.toolbar.range = document.createRange();
    protyle.toolbar.range.selectNodeContents(textElement);
    focusByRange(protyle.toolbar.range);
    cellElement.classList.add("av__cell--select");
    addDragFill(cellElement);
    hintRef(textElement.textContent.trim(), protyle, "av");
};

const setGroupFolded = (foldElement: HTMLElement, folded: boolean) => {
    foldElement.firstElementChild.classList.toggle("av__group-arrow--open", !folded);
    foldElement.parentElement.nextElementSibling.classList.toggle("fn__none", folded);
    foldElement.setAttribute("aria-label", getGroupFoldTip(folded));
};

const getAVEditFieldMenuItems = (protyle: IProtyle, blockElement: HTMLElement): IMenu[] => {
    return getEditableAVFields(blockElement).map(field => {
        const item: IMenu = {
            iconHTML: field.icon ? unicode2Emoji(field.icon, "b3-menu__icon", true) :
                `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(field.type)}"></use></svg>`,
            label: escapeHtml(field.name || getColNameByType(field.type)),
        };
        if (field.type === "checkbox") {
            item.type = "submenu";
            item.submenu = [{
                iconHTML: "",
                label: window.siyuan.languages.checked,
                click(element) {
                    updateAVFieldValue({
                        protyle,
                        blockElement,
                        field,
                        anchorElement: element,
                        value: {checked: true},
                    });
                }
            }, {
                iconHTML: "",
                label: window.siyuan.languages.unchecked,
                click(element) {
                    updateAVFieldValue({
                        protyle,
                        blockElement,
                        field,
                        anchorElement: element,
                        value: {checked: false},
                    });
                }
            }];
        } else if (["mSelect", "mAsset", "relation"].includes(field.type)) {
            item.type = "submenu";
            item.submenu = [{
                iconHTML: "",
                label: window.siyuan.languages.addAttr,
                click(element) {
                    openAVFieldEditor({protyle, blockElement, field, anchorElement: element, mode: "add"});
                    return true;
                }
            }, {
                iconHTML: "",
                label: window.siyuan.languages.remove,
                click(element) {
                    openAVFieldEditor({protyle, blockElement, field, anchorElement: element, mode: "remove"});
                    return true;
                }
            }, {
                iconHTML: "",
                label: window.siyuan.languages.replace,
                click(element) {
                    openAVFieldEditor({protyle, blockElement, field, anchorElement: element, mode: "replace"});
                    return true;
                }
            }];
        } else {
            item.click = (element) => {
                openAVFieldEditor({protyle, blockElement, field, anchorElement: element});
                return true;
            };
        }
        return item;
    });
};

const openAVEditFieldMenu = (protyle: IProtyle, blockElement: HTMLElement, anchorElement: HTMLElement) => {
    const menu = new Menu();
    getAVEditFieldMenuItems(protyle, blockElement).forEach(item => menu.addItem(item));
    if (isMobile()) {
        menu.fullscreen();
    } else {
        const rect = anchorElement.getBoundingClientRect();
        menu.open({x: rect.left, y: rect.bottom, w: rect.width, h: rect.height});
    }
};

let foldTimeout: number;
export const avClick = (protyle: IProtyle, event: MouseEvent & { target: HTMLElement }) => {
    const templateInteractiveElement = getAVTemplateInteractiveElement(event.target);
    if (templateInteractiveElement) {
        if (isAVTemplateLink(templateInteractiveElement)) {
            event.preventDefault();
        }
        event.stopPropagation();
        return true;
    }
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
        if (type === "av-selection-edit" && !protyle.disabled) {
            openAVEditFieldMenu(protyle, blockElement as HTMLElement, target);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-selection-delete" && !protyle.disabled) {
            deleteRow(blockElement as HTMLElement, protyle);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-selection-more") {
            const rect = target.getBoundingClientRect();
            avContextmenu(protyle, undefined, {
                x: rect.left,
                y: rect.bottom,
                w: rect.width,
                h: rect.height,
            }, {
                blockElement: blockElement as HTMLElement,
                anchorElement: target,
            });
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-header-add" && !protyle.disabled) {
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
            const templateID = blockElement.querySelector<HTMLElement>(".av__header")?.dataset.defaultTemplateId;
            if (templateID) {
                createAttributeViewItem({blockElement, protyle, templateID});
            } else {
                insertRows({
                    blockElement,
                    protyle,
                    count: 1,
                    previousID: "",
                    groupID: "",
                });
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-add-template" && !protyle.disabled) {
            openNewItemTemplateMenu({protyle, blockElement, target});
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
        } else if (type === "av-row-open") {
            openDatabaseRow(protyle, target, blockElement);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-gallery-open") {
            openDatabaseRow(protyle, target, blockElement);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-row-update" && !protyle.disabled) {
            updateDatabaseRow(protyle, target);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-cover-position" && !protyle.disabled) {
            startCardCoverPosition(protyle, target);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-cover-position-reset" && !protyle.disabled) {
            resetCardCoverPosition(target);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-cover-position-cancel" && !protyle.disabled) {
            finishCardCoverPosition(protyle, target, false);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-cover-position-confirm" && !protyle.disabled) {
            finishCardCoverPosition(protyle, target, true);
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (isCardCoverPositioning(target)) {
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (viewType === "gallery" && target.classList.contains("av__gallery-cover")) {
            openDatabaseRow(protyle, target, blockElement);
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
            const previousID = (bodyElement && bodyElement.querySelector(".av__row--util")?.previousElementSibling?.getAttribute("data-id")) ||
                target.previousElementSibling?.getAttribute("data-id") || undefined;
            const groupID = bodyElement ? bodyElement.getAttribute("data-group-id") : "";
            const templateID = blockElement.querySelector<HTMLElement>(".av__header")?.dataset.defaultTemplateId;
            if (templateID) {
                createAttributeViewItem({blockElement, protyle, templateID, position: {previousID, groupID}});
            } else {
                insertRows({blockElement, protyle, count: 1, previousID, groupID});
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-kanban-group-more" && !protyle.disabled) {
            openKanbanGroupMenu({protyle, blockElement, target});
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (type === "av-add-top" && !protyle.disabled) {
            const titleElement = hasClosestByClassName(target, "av__group-title");
            const groupID = titleElement ? titleElement.nextElementSibling.getAttribute("data-group-id") : "";
            const templateID = blockElement.querySelector<HTMLElement>(".av__header")?.dataset.defaultTemplateId;
            if (templateID) {
                createAttributeViewItem({blockElement, protyle, templateID, position: {previousID: "", groupID}});
            } else {
                insertRows({blockElement, protyle, count: 1, previousID: "", groupID});
            }
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
                        if (isMobile()) {
                            selectRow(rowElement.querySelector(".av__firstcol"), "toggle");
                        } else {
                            clearSelect(["row"], blockElement);
                        }
                    } else {
                        scrollElement.querySelectorAll(".av__row--select").forEach(item => {
                            item.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconUncheck");
                            item.classList.remove("av__row--select");
                        });
                        // 同步清空虚拟滚动选中快照，避免被 trim 掉的行回填后仍带选中态
                        blockElement.querySelectorAll(".av__body").forEach((bodyEl: HTMLElement) => {
                            resetAVRowSelect(bodyEl, []);
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
            }, target.querySelector("img"), {ownerElement: protyle.element});
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
            const isOpen = target.firstElementChild.classList.contains("av__group-arrow--open");
            const viewID = blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) ||
                blockElement.querySelector(".layout-tab-bar .item--focus")?.getAttribute("data-id");
            if (event.altKey) {
                const folded = isOpen;
                const doData: Record<string, boolean> = {};
                const undoData = getGroupFoldedStates(blockElement);
                blockElement.querySelectorAll('[data-type="av-group-fold"]').forEach((item: HTMLElement) => {
                    const groupID = item.dataset.id;
                    if (!groupID) {
                        return;
                    }
                    if (typeof undoData[groupID] !== "boolean") {
                        undoData[groupID] = !item.firstElementChild.classList.contains("av__group-arrow--open");
                    }
                    item.setAttribute("data-processed", "true");
                    setGroupFolded(item, folded);
                });
                Object.keys(undoData).forEach((groupID) => {
                    doData[groupID] = folded;
                });
                updateGroupFoldedStates(blockElement, doData);
                clearTimeout(foldTimeout);
                transaction(protyle, [{
                    action: "foldAttrViewGroups",
                    avID: blockElement.dataset.avId,
                    blockID: blockElement.dataset.nodeId,
                    viewID,
                    data: doData
                }], [{
                    action: "foldAttrViewGroups",
                    avID: blockElement.dataset.avId,
                    blockID: blockElement.dataset.nodeId,
                    viewID,
                    data: undoData
                }]);
            } else {
                target.setAttribute("data-processed", "true");
                setGroupFolded(target, isOpen);
                updateGroupFoldedStates(blockElement, {[target.dataset.id]: isOpen});
                clearTimeout(foldTimeout);
                foldTimeout = window.setTimeout(() => {
                    transaction(protyle, [{
                        action: "foldAttrViewGroup",
                        avID: blockElement.dataset.avId,
                        blockID: blockElement.dataset.nodeId,
                        viewID,
                        id: target.dataset.id,
                        data: isOpen
                    }], [{
                        action: "foldAttrViewGroup",
                        avID: blockElement.dataset.avId,
                        blockID: blockElement.dataset.nodeId,
                        viewID,
                        id: target.dataset.id,
                        data: !isOpen
                    }]);
                }, Constants.TIMEOUT_COUNT);
            }
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
            const rowElement = hasClosestByClassName(target, "av__row") as HTMLElement;
            if (!isMobile() && event.shiftKey) {
                selectAVItemRange(blockElement, rowElement);
            } else {
                selectRow(target, "toggle");
                setAVItemAnchor(blockElement, rowElement);
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("item") && target.parentElement.classList.contains("layout-tab-bar")) {
            if (target.classList.contains("item--focus")) {
                openViewMenu({protyle, blockElement, element: target});
            } else if (protyle.options.action.includes(Constants.CB_GET_HISTORY)) {
                clearSelect(["row", "galleryItem"], blockElement);
                blockElement.setAttribute(Constants.CUSTOM_SY_AV_VIEW, target.dataset.id);
                blockElement.removeAttribute("data-render");
                if (target.dataset.page) {
                    blockElement.querySelectorAll(".av__body").forEach((bodyItem: HTMLElement) => {
                        bodyItem.dataset.pageSize = target.dataset.page;
                    });
                }
                avRender(blockElement, protyle);
            } else {
                clearSelect(["row", "galleryItem"], blockElement);
                transaction(protyle, [{
                    action: "setAttrViewBlockView",
                    blockID: blockElement.getAttribute("data-node-id"),
                    id: target.dataset.id,
                    avID: blockElement.getAttribute("data-av-id"),
                }], [{
                    action: "setAttrViewBlockView",
                    blockID: blockElement.getAttribute("data-node-id"),
                    id: getAVCurrentViewID(blockElement),
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
                blockElement.querySelector('[data-type="av-search"]')?.textContent.trim() || ""
            );
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__row") && event.shiftKey && !target.classList.contains("av__row--header")) {
            if (isMobile()) {
                selectRow(target.querySelector(".av__firstcol"), "toggle");
            } else {
                selectAVItemRange(blockElement, target);
            }
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
            const searchElement = blockElement.querySelector('div[data-type="av-search"]') as HTMLInputElement;
            searchElement.style.width = "128px";
            searchElement.style.paddingLeft = "";
            searchElement.style.marginRight = "1em";
            const viewsElement = hasClosestByClassName(searchElement, "av__views");
            if (viewsElement) {
                viewsElement.classList.add("av__views--show");
            }
            if (window.JSAndroid && window.JSAndroid.showKeyboard || window.JSHarmony && window.JSHarmony.showKeyboard) {
                callMobileAppShowKeyboard();
                setTimeout(() => {
                    searchElement.focus();
                }, Constants.TIMEOUT_TRANSITION);
            } else {
                searchElement.focus();
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        target = target.parentElement;
    }
    return false;
};

export const avContextmenu = (protyle: IProtyle, rowElement: HTMLElement | undefined, position: IPosition, options?: {
    blockElement?: HTMLElement;
    anchorElement?: HTMLElement;
}) => {
    hideElements(["hint"], protyle);
    if (rowElement?.classList.contains("av__row--header")) {
        return false;
    }
    const blockElement = options?.blockElement || (rowElement ? hasClosestBlock(rowElement) : undefined);
    if (!blockElement) {
        return false;
    }
    const avType = blockElement.getAttribute("data-av-type") as TAVView;
    if (rowElement && avType === "table") {
        if (!rowElement.classList.contains("av__row--select")) {
            clearSelect(["row"], blockElement);
        }
        clearSelect(["cell"], blockElement);
        rowElement.classList.add("av__row--select");
        rowElement.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconCheck");
        const bodyElement = hasClosestByClassName(rowElement, "av__body") as HTMLElement;
        const rowId = rowElement.getAttribute("data-id");
        if (bodyElement && rowId) {
            updateAVRowSelect(bodyElement, rowId, true);
        }
        updateHeader(rowElement);
    } else if (rowElement) {
        if (!rowElement.classList.contains("av__gallery-item--select")) {
            clearSelect(["galleryItem"], blockElement);
        }
        rowElement.classList.add("av__gallery-item--select");
        const bodyElement = hasClosestByClassName(rowElement, "av__body") as HTMLElement;
        const rowId = rowElement.getAttribute("data-id");
        if (bodyElement && rowId) {
            updateAVRowSelect(bodyElement, rowId, true);
        }
        updateHeader(rowElement);
    }
    if (rowElement) {
        setAVItemAnchor(blockElement as HTMLElement, rowElement);
    }
    const anchorElement = options?.anchorElement || rowElement;
    if (!anchorElement) {
        return false;
    }
    const menu = new Menu();
    const rowElements = blockElement.querySelectorAll(".av__row--select:not(.av__row--header), .av__gallery-item--select");
    const selectedItemInfos = getAVSelectedItemInfos(blockElement);
    const selectedItems = getAVSelectedItems(blockElement);
    const primaryRows = selectedItemInfos
        .map(item => getPrimaryRowInfo(blockElement,
            blockElement.querySelector(`.av__row[data-id="${item.itemID}"], .av__gallery-item[data-id="${item.itemID}"]`) as HTMLElement,
            item.itemID))
        .filter((item): item is NonNullable<ReturnType<typeof getPrimaryRowInfo>> => Boolean(item));
    if (primaryRows.length !== selectedItemInfos.length) {
        return false;
    }
    const ids = primaryRows.map(item => item.blockID);
    const databaseItemLinks = selectedItemInfos.map((item, index) => ({
        content: primaryRows[index].content,
        link: genAVItemLink(
            blockElement.dataset.nodeId || "",
            getAVCurrentViewID(blockElement),
            item.itemID,
            item.groupID,
        ),
    }));
    if (selectedItemInfos.length === 1 && !primaryRows[0].isDetached) {
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
    primaryRows.forEach((item) => {
        if (!item.isDetached) {
            hasBlock = true;
        }
    });
    const copyMenu: IMenu[] = [{
        id: "copyKeyContent",
        iconHTML: "",
        label: window.siyuan.languages.copyKeyContent,
        click() {
            let text = "";
            primaryRows.forEach((item, i) => {
                if (selectedItemInfos.length > 1) {
                    text += "- ";
                }
                text += item.content.trim();
                if (ids.length > 1 && i !== ids.length - 1) {
                    text += "\n";
                }
            });
            writeText(text);
        }
    }, {
        id: "copyDatabaseItemLink",
        iconHTML: "",
        label: window.siyuan.languages.copyDatabaseItemLink,
        click() {
            writeText(formatAVItemLinks(databaseItemLinks, false));
        }
    }, {
        id: "copyDatabaseItemLinkInMd",
        iconHTML: "",
        label: window.siyuan.languages.copyDatabaseItemLinkInMd,
        click() {
            writeText(formatAVItemLinks(databaseItemLinks, true));
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
                    const primaryInfo = primaryRows[i];
                    if (primaryInfo.isDetached) {
                        content = primaryInfo.content;
                    } else {
                        content = `((${id} '${primaryInfo.content.replace(/[\n]+/g, " ")}'))`;
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
                    const primaryInfo = primaryRows[index];
                    if (primaryInfo.isDetached) {
                        text += primaryInfo.content;
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
                    const primaryInfo = primaryRows[index];
                    if (primaryInfo.isDetached) {
                        text += primaryInfo.content;
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
                    const primaryInfo = primaryRows[i];
                    if (primaryInfo.isDetached) {
                        content = primaryInfo.content;
                    } else {
                        content = `[${primaryInfo.content.replace(/[\n]+/g, " ")}](siyuan://blocks/${id})`;
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
                    const primaryInfo = primaryRows[i];
                    if (primaryInfo.isDetached) {
                        content = primaryInfo.content;
                    } else {
                        const response = await fetchSyncPost("/api/filetree/getHPathByID", {id});
                        if (response.code !== 0 || typeof response.data !== "string") {
                            continue;
                        }
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
                    const primaryInfo = primaryRows[index];
                    if (primaryInfo.isDetached) {
                        text += primaryInfo.content;
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

    copyMenu.push({
        id: "duplicate",
        iconHTML: "",
        label: window.siyuan.languages.duplicate,
        click: () => {
            duplicateRows(blockElement, protyle, selectedItemInfos.map(item => item.itemID));
        }
    });

    menu.addItem({
        id: "copy",
        label: window.siyuan.languages.copy,
        icon: "iconCopy",
        type: "submenu",
        submenu: copyMenu
    });
    if (!protyle.disabled) {
        const detachedItemIDs = selectedItems.filter(item => item.isDetached).map(item => item.itemID);
        if (detachedItemIDs.length > 0) {
            menu.addItem({
                id: "createDocAndBind",
                label: window.siyuan.languages.createDocAndBind,
                icon: "iconFile",
                accelerator: window.siyuan.config.keymap.editor.general.newNameSettingFile.custom,
                click() {
                    createAttributeViewItemDocs({
                        protyle,
                        blockElement,
                        itemIDs: detachedItemIDs,
                        saveMode: "template",
                    });
                }
            });
            menu.addItem({
                id: "createSubDocAndBind",
                label: window.siyuan.languages.createSubDocAndBind,
                icon: "iconFile",
                accelerator: window.siyuan.config.keymap.editor.general.newNameFile.custom,
                click() {
                    createAttributeViewItemDocs({
                        protyle,
                        blockElement,
                        itemIDs: detachedItemIDs,
                        saveMode: "subDoc",
                    });
                }
            });
        }
        menu.addItem({
            id: "addToDatabase",
            label: window.siyuan.languages.addToDatabase,
            icon: "iconDatabase",
            click() {
                openSearchAV({
                    avID: blockElement.getAttribute("data-av-id"),
                    target: anchorElement,
                    purpose: "addToDatabase",
                    blockID: blockElement.getAttribute("data-node-id"),
                    callback: (listItemElement) => {
                        const srcs: IOperationSrcs[] = [];
                        const sourceIds: string[] = [];
                        selectedItemInfos.forEach((item, index) => {
                            const primaryInfo = primaryRows[index];
                            srcs.push({
                                itemID: Lute.NewNodeID(),
                                content: primaryInfo.content,
                                id: primaryInfo.blockID,
                                isDetached: primaryInfo.isDetached,
                            });
                            sourceIds.push(item.itemID);
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
                            groupID: selectedItemInfos[0].groupID
                        }, {
                            action: "doUpdateUpdated",
                            id: listItemElement.dataset.blockId,
                            data: dayjs().format("YYYYMMDDHHmmss"),
                        }], [{
                            action: "removeAttrViewBlock",
                            srcIDs: sourceIds,
                            avID,
                        }]);
                    }
                });
            }
        });
        if (selectedItemInfos.length === 1) {
            if (!primaryRows[0].isDetached) {
                menu.addSeparator({id: "separator_1"});
            }
            menu.addItem({
                id: avType === "table" ? "insertRowBefore" : "insertItemBefore",
                icon: "iconBefore",
                label: `<div class="fn__flex" style="align-items: center;">
${window.siyuan.languages[avType === "table" ? "insertRowBefore" : "insertItemBefore"].replace("${x}", `<span class="fn__space"></span><input type="number" step="1" min="1" value="1" placeholder="${window.siyuan.languages.enterKey}" class="b3-text-field b3-text-field--size"><span class="fn__space"></span>`)}
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
                            previousID: selectedItemInfos[0].previousID,
                            groupID: selectedItemInfos[0].groupID
                        });
                        menu.close();
                    });
                    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                        if (!event.isComposing && event.key === "Enter") {
                            insertRows({
                                blockElement,
                                protyle,
                                count: parseInt(inputElement.value),
                                previousID: selectedItemInfos[0].previousID,
                                groupID: selectedItemInfos[0].groupID
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
${window.siyuan.languages[avType === "table" ? "insertRowAfter" : "insertItemAfter"].replace("${x}", `<span class="fn__space"></span><input type="number" step="1" min="1" placeholder="${window.siyuan.languages.enterKey}" class="b3-text-field b3-text-field--size" value="1"><span class="fn__space"></span>`)}
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
                            previousID: selectedItemInfos[0].itemID,
                            groupID: selectedItemInfos[0].groupID
                        });
                        menu.close();
                    });
                    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                        if (!event.isComposing && event.key === "Enter") {
                            insertRows({
                                blockElement,
                                protyle,
                                count: parseInt(inputElement.value),
                                previousID: selectedItemInfos[0].itemID,
                                groupID: selectedItemInfos[0].groupID
                            });
                            menu.close();
                        }
                    });
                }
            });
            menu.addSeparator({id: "separator_2"});
            if (!primaryRows[0].isDetached) {
                menu.addItem({
                    id: "unbindBlock",
                    label: window.siyuan.languages.unbindBlock,
                    icon: "iconLinkOff",
                    click() {
                        unbindDatabaseRow(
                            protyle,
                            blockElement,
                            selectedItemInfos[0].itemID,
                            primaryRows[0]
                        );
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
        menu.addItem({
            id: "fields",
            icon: "iconAttr",
            label: window.siyuan.languages.editFields,
            type: "submenu",
            submenu: getAVEditFieldMenuItems(protyle, blockElement)
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
                selectRowIds: selectedItemInfos.map(item => item.itemID),
                selectRowPoints: getAVSelectedItemPoints(blockElement),
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
    }], {
        callback: () => {
            if (protyle.databaseAttributePanel?.hasDatabase(avId)) {
                protyle.databaseAttributePanel.refresh();
            }
        }
    });
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
            cellElement.innerHTML = renderCell(value, 0, iconElement ? !iconElement.classList.contains("fn__none") : false,
                viewType, undefined, cellElement.dataset.dateFormat as TAVDateFormat);
            cellElement.parentElement.setAttribute("data-empty", cellValueIsEmpty(value).toString());
        } else {
            cellElement.innerHTML = renderCell(value, 0, iconElement ? !iconElement.classList.contains("fn__none") : false,
                undefined, undefined, cellElement.dataset.dateFormat as TAVDateFormat);
        }
        if (hasDragFill) {
            addDragFill(cellElement);
        }
        renderCellAttr(cellElement, value);
    }
};

export const updateAttrViewColAnimation = (protyle: IProtyle, avID: string, colID: string, headerValue: {
    icon?: string,
    name?: string,
    type?: TAVCol
}) => {
    protyle.wysiwyg.element.querySelectorAll<HTMLElement>(
        `.av[data-av-id="${avID}"] .av__row--header .av__cell[data-col-id="${colID}"]`
    ).forEach(item => {
        updateAttrViewCellAnimation(item, undefined, headerValue);
    });
    document.querySelectorAll<HTMLElement>(
        `.custom-attr [data-av-id="${avID}"] > .av__row[data-col-id="${colID}"]`
    ).forEach(item => {
        if (typeof headerValue.name !== "undefined") {
            const nameElement = item.querySelector(".block__logo span");
            if (nameElement) {
                nameElement.textContent = headerValue.name;
            }
        }
        if (typeof headerValue.icon !== "undefined") {
            const iconElement = item.querySelector(".block__logoicon");
            const type = item.querySelector<HTMLElement>(":scope > [data-type][data-col-id]")?.dataset.type as TAVCol;
            if (iconElement && type) {
                iconElement.outerHTML = headerValue.icon ?
                    unicode2Emoji(headerValue.icon, "block__logoicon", true) :
                    `<svg class="block__logoicon"><use xlink:href="#${getColIconByType(type)}"></use></svg>`;
            }
        }
    });
};

export const removeAttrViewColAnimation = (blockElement: Element, id: string) => {
    const avID = blockElement.getAttribute("data-av-id");
    if (avID) {
        document.querySelectorAll(`.av[data-av-id="${avID}"] .av__cell[data-col-id="${id}"]`).forEach(item => {
            item.remove();
        });
        document.querySelectorAll(`.custom-attr [data-av-id="${avID}"] > .av__row[data-col-id="${id}"]`).forEach(item => {
            item.remove();
        });
    } else {
        blockElement.querySelectorAll(`.av__cell[data-col-id="${id}"]`).forEach(item => {
            item.remove();
        });
    }
};

export const duplicateCompletely = (protyle: IProtyle, nodeElement: HTMLElement) => {
    fetchPost("/api/av/duplicateAttributeViewBlock", {avID: nodeElement.getAttribute("data-av-id")}, (response) => {
        nodeElement.classList.remove("protyle-wysiwyg--select");
        const tempElement = document.createElement("template");
        tempElement.innerHTML = protyle.lute.SpinBlockDOM(`<div class="av" data-node-id="${response.data.blockID}" data-av-id="${response.data.avID}" data-type="NodeAttributeView" data-av-type="table"></div>`);
        const cloneElement = tempElement.content.firstElementChild;
        const viewID = nodeElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW);
        const visibleViewIDs = nodeElement.getAttribute(Constants.CUSTOM_SY_AV_VISIBLE_VIEWS);
        if (viewID) {
            cloneElement.setAttribute(Constants.CUSTOM_SY_AV_VIEW, viewID);
        }
        if (visibleViewIDs) {
            cloneElement.setAttribute(Constants.CUSTOM_SY_AV_VISIBLE_VIEWS, visibleViewIDs);
        }
        cloneElement.setAttribute("data-av-type", nodeElement.getAttribute("data-av-type") || "table");
        const blockDOM = cloneElement.outerHTML;
        cloneElement.setAttribute("data-render", "true");
        nodeElement.after(cloneElement);
        // 首次渲染需等待插入事务完成，内核才能通过新块 ID 解析复制的载体视图。
        transaction(protyle, [{
            action: "insert",
            data: blockDOM,
            id: response.data.blockID,
            previousID: nodeElement.dataset.nodeId,
        }], [{
            action: "delete",
            id: response.data.blockID,
        }], {
            callback: () => {
                cloneElement.removeAttribute("data-render");
                if (!cloneElement.isConnected) {
                    return;
                }
                avRender(cloneElement, protyle, () => {
                    focusBlock(cloneElement);
                    scrollCenter(protyle);
                });
            }
        });
    });
};
