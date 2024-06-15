import {transaction} from "../../wysiwyg/transaction";
import {fetchPost} from "../../../util/fetch";
import {addCol} from "./col";
import {bindEditEvent, duplicateCol, getColIconByType, getEditHTML} from "./col";
import {setPosition} from "../../../util/setPosition";
import {hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";
import {bindSelectEvent, getSelectHTML, addColOptionOrCell, setColOption, removeCellOption} from "./select";
import {addFilter, getFiltersHTML, setFilter} from "./filter";
import {addSort, bindSortsEvent, getSortsHTML} from "./sort";
import {bindDateEvent, getDateHTML} from "./date";
import {formatNumber} from "./number";
import {removeAttrViewColAnimation, updateAttrViewCellAnimation} from "./action";
import {addAssetLink, bindAssetEvent, editAssetItem, getAssetHTML, updateAssetCell} from "./asset";
import {Constants} from "../../../constants";
import {hideElements} from "../../ui/hideElements";
import {isLocalPath, pathPosix} from "../../../util/pathName";
import {openEmojiPanel, unicode2Emoji} from "../../../emoji";
import {getSearch} from "../../../util/functions";
/// #if !MOBILE
import {openAsset} from "../../../editor/util";
/// #endif
import {previewImage} from "../../preview/image";
import {assetMenu} from "../../../menus/protyle";
import {addView, bindViewEvent, getSwitcherHTML, getViewHTML, openViewMenu} from "./view";
import {removeBlock} from "../../wysiwyg/remove";
import {focusBlock, getEditorRange} from "../../util/selection";
import {avRender} from "./render";
import {setPageSize} from "./row";
import {bindRelationEvent, getRelationHTML, openSearchAV, setRelationCell, updateRelation} from "./relation";
import {bindRollupData, getRollupHTML, goSearchRollupCol} from "./rollup";
import {updateCellsValue} from "./cell";
import {openCalcMenu} from "./calc";
import * as dayjs from "dayjs";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {escapeAttr} from "../../../util/escape";

export const openMenuPanel = (options: {
    protyle: IProtyle,
    blockElement: Element,
    type: "select" | "properties" | "config" | "sorts" | "filters" | "edit" | "date" | "asset" | "switcher" | "relation" | "rollup",
    colId?: string, // for edit, rollup
    // 使用前端构造的数据
    editData?: {
        previousID: string,
        colData: IAVColumn,
    },
    cellElements?: HTMLElement[],   // for select & date & relation & asset
    cb?: (avPanelElement: Element) => void
}) => {
    let avPanelElement = document.querySelector(".av__panel");
    if (avPanelElement) {
        avPanelElement.remove();
        return;
    }
    const avID = options.blockElement.getAttribute("data-av-id");
    fetchPost("/api/av/renderAttributeView", {
        id: avID,
        query: (options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement)?.value || "",
        pageSize: parseInt(options.blockElement.getAttribute("data-page-size")) || undefined,
        viewID: options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW)
    }, (response) => {
        avPanelElement = document.querySelector(".av__panel");
        if (avPanelElement) {
            avPanelElement.remove();
            return;
        }
        window.siyuan.menus.menu.remove();
        const blockID = options.blockElement.getAttribute("data-node-id");

        const isCustomAttr = !options.blockElement.classList.contains("av");
        const data = response.data as IAV;
        let html;
        if (options.type === "config") {
            html = getViewHTML(data.view);
        } else if (options.type === "properties") {
            html = getPropertiesHTML(data.view);
        } else if (options.type === "sorts") {
            html = getSortsHTML(data.view.columns, data.view.sorts);
        } else if (options.type === "switcher") {
            html = getSwitcherHTML(data.views, data.viewID);
        } else if (options.type === "filters") {
            html = getFiltersHTML(data.view);
        } else if (options.type === "select") {
            html = getSelectHTML(data.view, options.cellElements, true);
        } else if (options.type === "asset") {
            html = getAssetHTML(options.cellElements);
        } else if (options.type === "edit") {
            if (options.editData) {
                if (options.editData.previousID) {
                    data.view.columns.find((item, index) => {
                        if (item.id === options.editData.previousID) {
                            data.view.columns.splice(index + 1, 0, options.editData.colData);
                            return true;
                        }
                    });
                } else {
                    data.view.columns.splice(0, 0, options.editData.colData);
                }
            }
            html = getEditHTML({protyle: options.protyle, data, colId: options.colId, isCustomAttr});
        } else if (options.type === "date") {
            html = getDateHTML(data.view, options.cellElements);
        } else if (options.type === "rollup") {
            html = `<div class="b3-menu__items">${getRollupHTML({data, cellElements: options.cellElements})}</div>`;
        } else if (options.type === "relation") {
            html = getRelationHTML(data, options.cellElements);
            if (!html) {
                openMenuPanel({
                    protyle: options.protyle,
                    blockElement: options.blockElement,
                    type: "edit",
                    colId: options.cellElements[0].dataset.colId
                });
                return;
            }
        }

        document.body.insertAdjacentHTML("beforeend", `<div class="av__panel" style="z-index: ${++window.siyuan.zIndex}">
    <div class="b3-dialog__scrim" data-type="close"></div>
    <div class="b3-menu">${html}</div>
</div>`);
        avPanelElement = document.querySelector(".av__panel");
        let closeCB: () => void;
        const menuElement = avPanelElement.lastElementChild as HTMLElement;
        let tabRect = options.blockElement.querySelector(`.av__views, .av__row[data-col-id="${options.colId}"] > .block__logo`)?.getBoundingClientRect();
        if (["select", "date", "asset", "relation", "rollup"].includes(options.type)) {
            const cellRect = options.cellElements[options.cellElements.length - 1].getBoundingClientRect();
            if (options.type === "select") {
                bindSelectEvent(options.protyle, data, menuElement, options.cellElements, options.blockElement);
            } else if (options.type === "date") {
                closeCB = bindDateEvent({
                    protyle: options.protyle,
                    data,
                    menuElement,
                    cellElements: options.cellElements,
                    blockElement: options.blockElement
                });
            } else if (options.type === "asset") {
                bindAssetEvent({
                    protyle: options.protyle,
                    menuElement,
                    cellElements: options.cellElements,
                    blockElement: options.blockElement
                });
                setTimeout(() => {
                    setPosition(menuElement, cellRect.left, cellRect.bottom, cellRect.height);
                }, Constants.TIMEOUT_LOAD);  // 等待加载
            } else if (options.type === "relation") {
                bindRelationEvent({
                    menuElement,
                    cellElements: options.cellElements,
                    protyle: options.protyle,
                    blockElement: options.blockElement
                });
            } else if (options.type === "rollup") {
                bindRollupData({protyle: options.protyle, data, menuElement});
            }
            if (["select", "date", "relation", "rollup"].includes(options.type)) {
                const inputElement = menuElement.querySelector("input");
                if (inputElement) {
                    inputElement.select();
                    inputElement.focus();
                }
                setPosition(menuElement, cellRect.left, cellRect.bottom, cellRect.height);
            }
        } else {
            setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
            if (options.type === "sorts") {
                bindSortsEvent(options.protyle, menuElement, data, blockID);
            } else if (options.type === "edit") {
                bindEditEvent({protyle: options.protyle, data, menuElement, isCustomAttr, blockID});
            } else if (options.type === "config") {
                bindViewEvent({protyle: options.protyle, data, menuElement, blockElement: options.blockElement});
            }
        }
        if (options.cb) {
            options.cb(avPanelElement);
        }
        avPanelElement.addEventListener("dragstart", (event: DragEvent) => {
            window.siyuan.dragElement = event.target as HTMLElement;
            window.siyuan.dragElement.style.opacity = ".1";
            return;
        });
        avPanelElement.addEventListener("drop", (event) => {
            if (!window.siyuan.dragElement) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            window.siyuan.dragElement.style.opacity = "";
            const sourceElement = window.siyuan.dragElement;
            window.siyuan.dragElement = undefined;
            if (options.protyle && options.protyle.disabled) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (!options.protyle && window.siyuan.config.readonly) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const targetElement = avPanelElement.querySelector(".dragover__bottom, .dragover__top") as HTMLElement;
            if (!targetElement) {
                return;
            }
            const isTop = targetElement.classList.contains("dragover__top");
            const sourceId = sourceElement.dataset.id;
            const targetId = targetElement.dataset.id;
            if (targetElement.querySelector('[data-type="removeSort"]')) {
                const changeData = data.view.sorts;
                const oldData = Object.assign([], changeData);
                let sortFilter: IAVSort;
                changeData.find((sort, index: number) => {
                    if (sort.column === sourceId) {
                        sortFilter = changeData.splice(index, 1)[0];
                        return true;
                    }
                });
                changeData.find((sort, index: number) => {
                    if (sort.column === targetId) {
                        if (isTop) {
                            changeData.splice(index, 0, sortFilter);
                        } else {
                            changeData.splice(index + 1, 0, sortFilter);
                        }
                        return true;
                    }
                });

                transaction(options.protyle, [{
                    action: "setAttrViewSorts",
                    avID,
                    data: changeData,
                    blockID
                }], [{
                    action: "setAttrViewSorts",
                    avID,
                    data: oldData,
                    blockID
                }]);
                menuElement.innerHTML = getSortsHTML(data.view.columns, data.view.sorts);
                bindSortsEvent(options.protyle, menuElement, data, blockID);
                return;
            }
            if (targetElement.querySelector('[data-type="removeFilter"]')) {
                const changeData = data.view.filters;
                const oldData = Object.assign([], changeData);
                let targetFilter: IAVFilter;
                changeData.find((filter, index: number) => {
                    if (filter.column === sourceId) {
                        targetFilter = changeData.splice(index, 1)[0];
                        return true;
                    }
                });
                changeData.find((filter, index: number) => {
                    if (filter.column === targetId) {
                        if (isTop) {
                            changeData.splice(index, 0, targetFilter);
                        } else {
                            changeData.splice(index + 1, 0, targetFilter);
                        }
                        return true;
                    }
                });

                transaction(options.protyle, [{
                    action: "setAttrViewFilters",
                    avID,
                    data: changeData,
                    blockID
                }], [{
                    action: "setAttrViewFilters",
                    avID,
                    data: oldData,
                    blockID
                }]);
                menuElement.innerHTML = getFiltersHTML(data.view);
                return;
            }
            if (targetElement.querySelector('[data-type="av-view-edit"]')) {
                transaction(options.protyle, [{
                    action: "sortAttrViewView",
                    avID,
                    blockID,
                    id: sourceId,
                    previousID: isTop ? targetElement.previousElementSibling?.getAttribute("data-id") : targetElement.getAttribute("data-id")
                }], [{
                    action: "sortAttrViewView",
                    avID,
                    blockID,
                    id: sourceId,
                    previousID: sourceElement.previousElementSibling?.getAttribute("data-id")
                }]);
                if (isTop) {
                    targetElement.before(sourceElement);
                    targetElement.classList.remove("dragover__top");
                } else {
                    targetElement.after(sourceElement);
                    targetElement.classList.remove("dragover__bottom");
                }
                return;
            }
            if (targetElement.querySelector('[data-type="editAssetItem"]')) {
                if (isTop) {
                    targetElement.before(sourceElement);
                } else {
                    targetElement.after(sourceElement);
                }
                const replaceValue: IAVCellAssetValue[] = [];
                Array.from(targetElement.parentElement.children).forEach((item: HTMLElement) => {
                    if (item.dataset.content) {
                        replaceValue.push({
                            content: item.dataset.content,
                            name: item.dataset.name,
                            type: item.dataset.type as "image" | "file",
                        });
                    }
                });
                updateAssetCell({
                    protyle: options.protyle,
                    cellElements: options.cellElements,
                    replaceValue,
                    blockElement: options.blockElement
                });
                return;
            }
            if (targetElement.querySelector('[data-type="setColOption"]')) {
                const colId = options.cellElements ? options.cellElements[0].dataset.colId : menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
                const changeData = data.view.columns.find((column) => column.id === colId).options;
                const oldData = Object.assign([], changeData);
                let targetOption: { name: string, color: string };
                changeData.find((option, index: number) => {
                    if (option.name === sourceElement.dataset.name) {
                        targetOption = changeData.splice(index, 1)[0];
                        return true;
                    }
                });
                changeData.find((option, index: number) => {
                    if (option.name === targetElement.dataset.name) {
                        if (isTop) {
                            changeData.splice(index, 0, targetOption);
                        } else {
                            changeData.splice(index + 1, 0, targetOption);
                        }
                        return true;
                    }
                });
                transaction(options.protyle, [{
                    action: "updateAttrViewColOptions",
                    id: colId,
                    avID,
                    data: changeData,
                }], [{
                    action: "updateAttrViewColOptions",
                    id: colId,
                    avID,
                    data: oldData,
                }]);
                const oldScroll = menuElement.querySelector(".b3-menu__items").scrollTop;
                if (options.cellElements) {
                    menuElement.innerHTML = getSelectHTML(data.view, options.cellElements);
                    bindSelectEvent(options.protyle, data, menuElement, options.cellElements, options.blockElement);
                } else {
                    menuElement.innerHTML = getEditHTML({
                        protyle: options.protyle,
                        data,
                        colId,
                        isCustomAttr
                    });
                    bindEditEvent({protyle: options.protyle, data, menuElement, isCustomAttr, blockID});
                }
                menuElement.querySelector(".b3-menu__items").scrollTop = oldScroll;
                return;
            }
            if (targetElement.getAttribute("data-type") === "setRelationCell") {
                if (isTop) {
                    targetElement.before(sourceElement);
                } else {
                    targetElement.after(sourceElement);
                }
                targetElement.classList.remove("dragover__bottom", "dragover__top");
                const blockIDs: string[] = [];
                const contents: IAVCellValue[] = [];
                targetElement.parentElement.querySelectorAll(".fn__grab").forEach(item => {
                    const dateElement = item.nextElementSibling as HTMLElement;
                    blockIDs.push(dateElement.dataset.id);
                    contents.push({
                        isDetached: !dateElement.style.color,
                        type: "block",
                        block: {
                            content: dateElement.textContent,
                            id: dateElement.dataset.id
                        }
                    });
                });
                updateCellsValue(options.protyle, options.blockElement as HTMLElement, {
                    blockIDs,
                    contents,
                }, options.cellElements);
                return;
            }

            if (targetElement.getAttribute("data-type") === "editCol") {
                const previousID = (targetElement.classList.contains("dragover__top") ? targetElement.previousElementSibling?.getAttribute("data-id") : targetElement.getAttribute("data-id")) || "";
                const undoPreviousID = sourceElement.previousElementSibling?.getAttribute("data-id") || "";
                if (previousID !== undoPreviousID && previousID !== sourceId) {
                    transaction(options.protyle, [{
                        action: "sortAttrViewCol",
                        avID,
                        previousID,
                        id: sourceId,
                        blockID,
                    }], [{
                        action: "sortAttrViewCol",
                        avID,
                        previousID: undoPreviousID,
                        id: sourceId,
                        blockID
                    }]);
                    let column: IAVColumn;
                    data.view.columns.find((item, index: number) => {
                        if (item.id === sourceId) {
                            column = data.view.columns.splice(index, 1)[0];
                            return true;
                        }
                    });
                    data.view.columns.find((item, index: number) => {
                        if (item.id === targetId) {
                            if (isTop) {
                                data.view.columns.splice(index, 0, column);
                            } else {
                                data.view.columns.splice(index + 1, 0, column);
                            }
                            return true;
                        }
                    });
                }
                menuElement.innerHTML = getPropertiesHTML(data.view);
                return;
            }
        });
        let dragoverElement: HTMLElement;
        avPanelElement.addEventListener("dragover", (event: DragEvent) => {
            if (event.dataTransfer.types.includes("Files")) {
                event.preventDefault();
                return;
            }
            const target = event.target as HTMLElement;
            let targetElement = hasClosestByAttribute(target, "draggable", "true");
            if (!targetElement) {
                targetElement = hasClosestByAttribute(document.elementFromPoint(event.clientX, event.clientY - 1), "draggable", "true");
            }
            if (!targetElement || targetElement.isSameNode(window.siyuan.dragElement)) {
                return;
            }
            event.preventDefault();
            if (dragoverElement && targetElement.isSameNode(dragoverElement)) {
                const nodeRect = targetElement.getBoundingClientRect();
                targetElement.classList.remove("dragover__bottom", "dragover__top");
                if (event.clientY > nodeRect.top + nodeRect.height / 2) {
                    targetElement.classList.add("dragover__bottom");
                } else {
                    targetElement.classList.add("dragover__top");
                }
                return;
            }
            dragoverElement = targetElement;
        });
        avPanelElement.addEventListener("dragleave", () => {
            avPanelElement.querySelectorAll(".dragover__bottom, .dragover__top").forEach((item: HTMLElement) => {
                item.classList.remove("dragover__bottom", "dragover__top");
            });
        });
        avPanelElement.addEventListener("dragend", () => {
            if (window.siyuan.dragElement) {
                window.siyuan.dragElement.style.opacity = "";
                window.siyuan.dragElement = undefined;
            }
        });
        avPanelElement.addEventListener("click", (event: MouseEvent) => {
            let type: string;
            if (typeof event.detail === "string") {
                type = event.detail;
            }
            let target = event.target as HTMLElement;
            while (target && !target.isSameNode(avPanelElement) || type) {
                type = target?.dataset.type || type;
                if (type === "close") {
                    if (!options.protyle.toolbar.subElement.classList.contains("fn__none")) {
                        // 优先关闭资源文件搜索
                        hideElements(["util"], options.protyle);
                    } else if (!window.siyuan.menus.menu.element.classList.contains("fn__none")) {
                        // 过滤面板先关闭过滤条件
                        window.siyuan.menus.menu.remove();
                    } else {
                        closeCB?.();
                        avPanelElement.remove();
                        focusBlock(options.blockElement);
                    }
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "go-config") {
                    menuElement.innerHTML = getViewHTML(data.view);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    bindViewEvent({protyle: options.protyle, data, menuElement, blockElement: options.blockElement});
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "go-properties") {
                    // 复制列后点击返回到属性面板，宽度不一致，需重新计算
                    tabRect = options.blockElement.querySelector(".av__views").getBoundingClientRect();
                    menuElement.innerHTML = getPropertiesHTML(data.view);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goSorts") {
                    menuElement.innerHTML = getSortsHTML(data.view.columns, data.view.sorts);
                    bindSortsEvent(options.protyle, menuElement, data, blockID);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeSorts") {
                    transaction(options.protyle, [{
                        action: "setAttrViewSorts",
                        avID,
                        data: [],
                        blockID
                    }], [{
                        action: "setAttrViewSorts",
                        avID,
                        data: data.view.sorts,
                        blockID
                    }]);
                    data.view.sorts = [];
                    menuElement.innerHTML = getSortsHTML(data.view.columns, data.view.sorts);
                    bindSortsEvent(options.protyle, menuElement, data, blockID);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "addSort") {
                    addSort({
                        data,
                        rect: target.getBoundingClientRect(),
                        menuElement,
                        tabRect,
                        avId: avID,
                        protyle: options.protyle,
                        blockID,
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeSort") {
                    const oldSorts = Object.assign([], data.view.sorts);
                    data.view.sorts.find((item: IAVSort, index: number) => {
                        if (item.column === target.parentElement.dataset.id) {
                            data.view.sorts.splice(index, 1);
                            return true;
                        }
                    });
                    transaction(options.protyle, [{
                        action: "setAttrViewSorts",
                        avID,
                        data: data.view.sorts,
                        blockID
                    }], [{
                        action: "setAttrViewSorts",
                        avID,
                        data: oldSorts,
                        blockID
                    }]);
                    menuElement.innerHTML = getSortsHTML(data.view.columns, data.view.sorts);
                    bindSortsEvent(options.protyle, menuElement, data, blockID);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goFilters") {
                    menuElement.innerHTML = getFiltersHTML(data.view);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeFilters") {
                    transaction(options.protyle, [{
                        action: "setAttrViewFilters",
                        avID,
                        data: [],
                        blockID
                    }], [{
                        action: "setAttrViewFilters",
                        avID,
                        data: data.view.filters,
                        blockID
                    }]);
                    data.view.filters = [];
                    menuElement.innerHTML = getFiltersHTML(data.view);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "addFilter") {
                    addFilter({
                        data,
                        rect: target.getBoundingClientRect(),
                        menuElement,
                        tabRect,
                        avId: avID,
                        protyle: options.protyle,
                        blockElement: options.blockElement
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeFilter") {
                    window.siyuan.menus.menu.remove();
                    const oldFilters = Object.assign([], data.view.filters);
                    data.view.filters.find((item: IAVFilter, index: number) => {
                        if (item.column === target.parentElement.dataset.id && item.value.type === target.parentElement.dataset.filterType) {
                            data.view.filters.splice(index, 1);
                            return true;
                        }
                    });
                    transaction(options.protyle, [{
                        action: "setAttrViewFilters",
                        avID,
                        data: data.view.filters,
                        blockID
                    }], [{
                        action: "setAttrViewFilters",
                        avID,
                        data: oldFilters,
                        blockID
                    }]);
                    menuElement.innerHTML = getFiltersHTML(data.view);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "setFilter") {
                    data.view.filters.find((item: IAVFilter) => {
                        if (item.column === target.parentElement.parentElement.dataset.id && item.value.type === target.parentElement.parentElement.dataset.filterType) {
                            setFilter({
                                filter: item,
                                protyle: options.protyle,
                                data,
                                target,
                                blockElement: options.blockElement
                            });
                            return true;
                        }
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "numberFormat") {
                    formatNumber({
                        avPanelElement,
                        element: target,
                        protyle: options.protyle,
                        oldFormat: target.dataset.format,
                        colId: menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id"),
                        avID
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "newCol") {
                    avPanelElement.remove();
                    const addMenu = addCol(options.protyle, options.blockElement);
                    addMenu.open({
                        x: tabRect.right,
                        y: tabRect.bottom,
                        h: tabRect.height,
                        isLeft: true
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "update-view-icon") {
                    const rect = target.getBoundingClientRect();
                    openEmojiPanel("", "av", {
                        x: rect.left,
                        y: rect.bottom,
                        h: rect.height,
                        w: rect.width
                    }, (unicode) => {
                        transaction(options.protyle, [{
                            action: "setAttrViewViewIcon",
                            avID,
                            id: data.viewID,
                            data: unicode,
                        }], [{
                            action: "setAttrViewViewIcon",
                            id: data.viewID,
                            avID,
                            data: target.dataset.icon,
                        }]);
                        target.innerHTML = unicode ? unicode2Emoji(unicode) : '<svg><use xlink:href="#iconTable"></use></svg>';
                        target.dataset.icon = unicode;
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "set-page-size") {
                    setPageSize({
                        target,
                        protyle: options.protyle,
                        avID,
                        nodeElement: options.blockElement
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "duplicate-view") {
                    const id = Lute.NewNodeID();
                    transaction(options.protyle, [{
                        action: "duplicateAttrViewView",
                        avID,
                        previousID: data.viewID,
                        id,
                        blockID
                    }], [{
                        action: "removeAttrViewView",
                        avID,
                        id,
                        blockID
                    }]);
                    options.blockElement.setAttribute(Constants.CUSTOM_SY_AV_VIEW, id);
                    avPanelElement.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "delete-view") {
                    if (data.views.length === 1) {
                        removeBlock(options.protyle, options.blockElement, getEditorRange(options.blockElement), "remove");
                    } else {
                        transaction(options.protyle, [{
                            action: "removeAttrViewView",
                            avID,
                            id: data.viewID,
                            blockID
                        }]);
                    }
                    avPanelElement.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "update-icon") {
                    const rect = target.getBoundingClientRect();
                    openEmojiPanel("", "av", {
                        x: rect.left,
                        y: rect.bottom,
                        h: rect.height,
                        w: rect.width
                    }, (unicode) => {
                        const colId = menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
                        transaction(options.protyle, [{
                            action: "setAttrViewColIcon",
                            id: colId,
                            avID,
                            data: unicode,
                        }], [{
                            action: "setAttrViewColIcon",
                            id: colId,
                            avID,
                            data: target.dataset.icon,
                        }]);
                        target.innerHTML = unicode ? unicode2Emoji(unicode) : `<svg><use xlink:href="#${getColIconByType(target.dataset.colType as TAVCol)}"></use></svg>`;
                        if (isCustomAttr) {
                            const iconElement = options.blockElement.querySelector(`.av__row[data-col-id="${colId}"] .block__logoicon`);
                            iconElement.outerHTML = unicode ? unicode2Emoji(unicode, "block__logoicon", true) : `<svg class="block__logoicon"><use xlink:href="#${getColIconByType(iconElement.nextElementSibling.getAttribute("data-type") as TAVCol)}"></use></svg>`;
                        } else {
                            updateAttrViewCellAnimation(options.blockElement.querySelector(`.av__row--header .av__cell[data-col-id="${colId}"]`), undefined, {icon: unicode});
                        }
                        target.dataset.icon = unicode;
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "showAllCol") {
                    const doOperations: IOperation[] = [];
                    const undoOperations: IOperation[] = [];
                    data.view.columns.forEach((item: IAVColumn) => {
                        if (item.hidden) {
                            doOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                avID,
                                data: false,
                                blockID,
                            });
                            undoOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                avID,
                                data: true,
                                blockID
                            });
                            item.hidden = false;
                        }
                    });
                    if (doOperations.length > 0) {
                        transaction(options.protyle, doOperations, undoOperations);
                        menuElement.innerHTML = getPropertiesHTML(data.view);
                        setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "hideAllCol") {
                    const doOperations: IOperation[] = [];
                    const undoOperations: IOperation[] = [];
                    data.view.columns.forEach((item: IAVColumn) => {
                        if (!item.hidden && item.type !== "block") {
                            doOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                avID,
                                data: true,
                                blockID
                            });
                            undoOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                avID,
                                data: false,
                                blockID
                            });
                            item.hidden = true;
                        }
                    });
                    if (doOperations.length > 0) {
                        transaction(options.protyle, doOperations, undoOperations);
                        menuElement.innerHTML = getPropertiesHTML(data.view);
                        setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "editCol") {
                    menuElement.innerHTML = getEditHTML({
                        protyle: options.protyle,
                        data,
                        colId: target.dataset.id,
                        isCustomAttr
                    });
                    bindEditEvent({protyle: options.protyle, data, menuElement, isCustomAttr, blockID});
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "updateColType") {
                    if (target.dataset.newType !== target.dataset.oldType) {
                        const name = (avPanelElement.querySelector('.b3-text-field[data-type="name"]') as HTMLInputElement).value;
                        data.view.columns.find((item: IAVColumn) => item.id === options.colId).type = target.dataset.newType as TAVCol;
                        transaction(options.protyle, [{
                            action: "updateAttrViewCol",
                            id: options.colId,
                            avID,
                            name,
                            type: target.dataset.newType as TAVCol,
                        }], [{
                            action: "updateAttrViewCol",
                            id: options.colId,
                            avID,
                            name,
                            type: target.dataset.oldType as TAVCol,
                        }]);

                        // 需要取消 lineNumber 列的排序和过滤
                        if (target.dataset.newType === "lineNumber") {
                            const sortExist = data.view.sorts.find((sort) => sort.column === options.colId);
                            if (sortExist) {
                                const oldSorts = Object.assign([], data.view.sorts);
                                const newSorts = data.view.sorts.filter((sort) => sort.column !== options.colId);

                                transaction(options.protyle, [{
                                    action: "setAttrViewSorts",
                                    avID: data.id,
                                    data: newSorts,
                                    blockID,
                                }], [{
                                    action: "setAttrViewSorts",
                                    avID: data.id,
                                    data: oldSorts,
                                    blockID,
                                }]);
                            }

                            const filterExist = data.view.filters.find((filter) => filter.column === options.colId);
                            if (filterExist) {
                                const oldFilters = JSON.parse(JSON.stringify(data.view.filters));
                                const newFilters = data.view.filters.filter((filter) => filter.column !== options.colId);

                                transaction(options.protyle, [{
                                    action: "setAttrViewFilters",
                                    avID: data.id,
                                    data: newFilters,
                                    blockID
                                }], [{
                                    action: "setAttrViewFilters",
                                    avID: data.id,
                                    data: oldFilters,
                                    blockID
                                }]);
                            }
                        }
                    }
                    menuElement.innerHTML = getEditHTML({
                        protyle: options.protyle,
                        data,
                        colId: options.colId,
                        isCustomAttr
                    });
                    bindEditEvent({protyle: options.protyle, data, menuElement, isCustomAttr, blockID});
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goUpdateColType") {
                    const editMenuElement = hasClosestByClassName(target, "b3-menu");
                    if (editMenuElement) {
                        editMenuElement.firstElementChild.classList.add("fn__none");
                        editMenuElement.lastElementChild.classList.remove("fn__none");
                    }
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goSearchAV") {
                    openSearchAV(avID, target, undefined, false);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goSearchRollupCol") {
                    goSearchRollupCol({
                        target,
                        data,
                        isRelation: true,
                        protyle: options.protyle,
                        colId: options.colId || menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id")
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goSearchRollupTarget") {
                    goSearchRollupCol({
                        target,
                        data,
                        isRelation: false,
                        protyle: options.protyle,
                        colId: options.colId || menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id")
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goSearchRollupCalc") {
                    openCalcMenu(options.protyle, target, {
                        data,
                        colId: options.colId || menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id"),
                        blockID
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "updateRelation") {
                    updateRelation({
                        protyle: options.protyle,
                        avElement: avPanelElement,
                        avID,
                        colsData: data.view.columns,
                        blockElement: options.blockElement,
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goEditCol") {
                    const editMenuElement = hasClosestByClassName(target, "b3-menu");
                    if (editMenuElement) {
                        editMenuElement.firstElementChild.classList.remove("fn__none");
                        editMenuElement.lastElementChild.classList.add("fn__none");
                    }
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "hideCol") {
                    const isEdit = menuElement.querySelector('[data-type="go-properties"]');
                    const colId = isEdit ? menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id") : target.parentElement.getAttribute("data-id");
                    transaction(options.protyle, [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        avID,
                        data: true,
                        blockID
                    }], [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        avID,
                        data: false,
                        blockID
                    }]);
                    data.view.columns.find((item: IAVColumn) => item.id === colId).hidden = true;
                    if (isEdit) {
                        menuElement.innerHTML = getEditHTML({
                            protyle: options.protyle,
                            data,
                            colId,
                            isCustomAttr
                        });
                        bindEditEvent({protyle: options.protyle, data, menuElement, isCustomAttr, blockID});
                    } else {
                        menuElement.innerHTML = getPropertiesHTML(data.view);
                    }
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "showCol") {
                    const isEdit = menuElement.querySelector('[data-type="go-properties"]');
                    const colId = isEdit ? menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id") : target.parentElement.getAttribute("data-id");
                    transaction(options.protyle, [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        avID,
                        data: false,
                        blockID
                    }], [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        avID,
                        data: true,
                        blockID
                    }]);
                    data.view.columns.find((item: IAVColumn) => item.id === colId).hidden = false;
                    if (isEdit) {
                        menuElement.innerHTML = getEditHTML({
                            protyle: options.protyle,
                            data,
                            colId,
                            isCustomAttr
                        });
                        bindEditEvent({protyle: options.protyle, data, menuElement, isCustomAttr, blockID});
                    } else {
                        menuElement.innerHTML = getPropertiesHTML(data.view);
                    }
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "duplicateCol") {
                    duplicateCol({
                        blockElement: options.blockElement,
                        protyle: options.protyle,
                        colId: menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id"),
                        data,
                        viewID: data.viewID,
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeCol") {
                    confirmDialog(isCustomAttr ? window.siyuan.languages.deleteOpConfirm : "", isCustomAttr ? window.siyuan.languages.removeCol.replace("${x}", menuElement.querySelector("input").value) : "", () => {
                        const colId = menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
                        let previousID: string;
                        const colData = data.view.columns.find((item: IAVColumn, index) => {
                            if (item.id === colId) {
                                previousID = data.view.columns[index - 1]?.id;
                                data.view.columns.splice(index, 1);
                                return true;
                            }
                        });
                        const newUpdated = dayjs().format("YYYYMMDDHHmmss");
                        transaction(options.protyle, [{
                            action: "removeAttrViewCol",
                            id: colId,
                            avID,
                        }, {
                            action: "doUpdateUpdated",
                            id: blockID,
                            data: newUpdated,
                        }], [{
                            action: "addAttrViewCol",
                            name: colData.name,
                            avID,
                            type: colData.type,
                            id: colId,
                            previousID
                        }, {
                            action: "doUpdateUpdated",
                            id: blockID,
                            data: options.blockElement.getAttribute("updated")
                        }]);
                        removeAttrViewColAnimation(options.blockElement, colId);
                        options.blockElement.setAttribute("updated", newUpdated);

                        if (isCustomAttr) {
                            avPanelElement.remove();
                        } else {
                            tabRect = options.blockElement.querySelector(".av__views").getBoundingClientRect();
                            menuElement.innerHTML = getPropertiesHTML(data.view);
                            setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                        }
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "setColOption") {
                    setColOption(options.protyle, data, target, options.blockElement, isCustomAttr, options.cellElements);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "setRelationCell") {
                    setRelationCell(options.protyle, options.blockElement as HTMLElement, target, options.cellElements);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "addColOptionOrCell") {
                    if (target.querySelector(".b3-menu__checked")) {
                        removeCellOption(options.protyle, options.cellElements, menuElement.querySelector(`.b3-chips .b3-chip[data-content="${escapeAttr(target.dataset.name)}"]`), options.blockElement);
                    } else {
                        addColOptionOrCell(options.protyle, data, options.cellElements, target, menuElement, options.blockElement);
                    }
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeCellOption") {
                    removeCellOption(options.protyle, options.cellElements, target.parentElement, options.blockElement);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "addAssetLink") {
                    addAssetLink(options.protyle, options.cellElements, target, options.blockElement);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "addAssetExist") {
                    const rect = target.getBoundingClientRect();
                    assetMenu(options.protyle, {
                        x: rect.right,
                        y: rect.bottom,
                        w: target.parentElement.clientWidth + 8,
                        h: rect.height
                    }, (url, name) => {
                        let value: IAVCellAssetValue;
                        if (Constants.SIYUAN_ASSETS_IMAGE.includes(pathPosix().extname(url).toLowerCase())) {
                            value = {
                                type: "image",
                                content: url,
                                name: ""
                            };
                        } else {
                            value = {
                                type: "file",
                                content: url,
                                name
                            };
                        }
                        updateAssetCell({
                            protyle: options.protyle,
                            cellElements: options.cellElements,
                            addValue: [value],
                            blockElement: options.blockElement
                        });
                        window.siyuan.menus.menu.remove();
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "openAssetItem") {
                    const assetLink = target.parentElement.dataset.content;
                    const suffix = pathPosix().extname(assetLink);
                    /// #if !MOBILE
                    if (isLocalPath(assetLink) && (
                        [".pdf"].concat(Constants.SIYUAN_ASSETS_AUDIO).concat(Constants.SIYUAN_ASSETS_VIDEO).includes(suffix) && (
                            suffix !== ".pdf" || (suffix === ".pdf" && !assetLink.startsWith("file://"))
                        )
                    )) {
                        openAsset(options.protyle.app, assetLink.trim(), parseInt(getSearch("page", assetLink)), "right");
                    } else if (Constants.SIYUAN_ASSETS_IMAGE.includes(suffix)) {
                        previewImage(assetLink);
                    } else {
                        window.open(assetLink);
                    }
                    /// #else
                    if (Constants.SIYUAN_ASSETS_IMAGE.includes(suffix)) {
                        previewImage(assetLink);
                    } else {
                        window.open(assetLink);
                    }
                    /// #endif
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "editAssetItem") {
                    editAssetItem({
                        protyle: options.protyle,
                        cellElements: options.cellElements,
                        blockElement: options.blockElement,
                        content: target.parentElement.dataset.content,
                        type: target.parentElement.dataset.type as "image" | "file",
                        name: target.parentElement.dataset.name,
                        index: parseInt(target.parentElement.dataset.index),
                        rect: target.parentElement.getBoundingClientRect()
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "clearDate") {
                    updateCellsValue(options.protyle, options.blockElement as HTMLElement, {
                        isNotEmpty2: false,
                        isNotEmpty: false,
                        content: null,
                        content2: null,
                        hasEndDate: false,
                        isNotTime: true,
                    }, options.cellElements);
                    avPanelElement.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "av-add") {
                    window.siyuan.menus.menu.remove();
                    addView(options.protyle, options.blockElement);
                    avPanelElement.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "av-view-switch") {
                    if (!target.querySelector(".b3-chip--primary")) {
                        options.blockElement.removeAttribute("data-render");
                        avRender(options.blockElement, options.protyle, undefined, target.parentElement.dataset.id);
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "av-view-edit") {
                    if (target.parentElement.querySelector(".b3-chip--primary")) {
                        openViewMenu({
                            protyle: options.protyle,
                            blockElement: options.blockElement as HTMLElement,
                            element: target.parentElement
                        });
                    } else {
                        options.blockElement.removeAttribute("data-render");
                        avRender(options.blockElement, options.protyle, () => {
                            openViewMenu({
                                protyle: options.protyle,
                                blockElement: options.blockElement as HTMLElement,
                                element: target.parentElement
                            });
                            avPanelElement.querySelector(".b3-chip--primary").classList.remove("b3-chip--primary");
                            target.parentElement.querySelector(".b3-chip").classList.add("b3-chip--primary");
                        }, target.parentElement.dataset.id);
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                // 有错误日志，没找到重现步骤，需先判断一下
                if (!target || !target.parentElement) {
                    break;
                }
                target = target.parentElement;
            }
        });
    });
};

export const getPropertiesHTML = (data: IAVTable) => {
    let showHTML = "";
    let hideHTML = "";
    data.columns.forEach((item: IAVColumn) => {
        if (item.hidden) {
            hideHTML += `<button class="b3-menu__item" data-type="editCol" draggable="true" data-id="${item.id}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="b3-menu__label fn__flex">
        ${item.icon ? unicode2Emoji(item.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>`}
        ${item.name || "&nbsp;"}
    </div>
    <svg class="b3-menu__action" data-type="showCol"><use xlink:href="#iconEye"></use></svg>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>`;
        } else {
            showHTML += `<button class="b3-menu__item" data-type="editCol" draggable="true" data-id="${item.id}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="b3-menu__label fn__flex">
        ${item.icon ? unicode2Emoji(item.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>`}
        ${item.name || "&nbsp;"}
    </div>
    <svg class="b3-menu__action${item.type === "block" ? " fn__none" : ""}" data-type="hideCol"><use xlink:href="#iconEyeoff"></use></svg>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>`;
        }
    });
    if (hideHTML) {
        hideHTML = `<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label">
        ${window.siyuan.languages.hideCol} 
    </span>
    <span class="block__icon" data-type="showAllCol">
        ${window.siyuan.languages.showAll}
        <span class="fn__space"></span>
        <svg><use xlink:href="#iconEye"></use></svg>
    </span>
</button>
${hideHTML}`;
    }
    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="go-config">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages.attr}</span>
</button>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label">
        ${window.siyuan.languages.showCol} 
    </span>
    <span class="block__icon" data-type="hideAllCol">
        ${window.siyuan.languages.hideAll}
        <span class="fn__space"></span>
        <svg><use xlink:href="#iconEyeoff"></use></svg>
    </span>
</button>
${showHTML}
${hideHTML}
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="newCol">
    <svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.new}</span>
</button>
</div>`;
};

