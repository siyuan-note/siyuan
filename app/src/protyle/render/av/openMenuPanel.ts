import {transaction} from "../../wysiwyg/transaction";
import {fetchPost} from "../../../util/fetch";
import {addCol} from "./addCol";
import {bindEditEvent, duplicateCol, getColIconByType, getEditHTML} from "./col";
import {setPosition} from "../../../util/setPosition";
import {hasClosestByAttribute} from "../../util/hasClosest";
import {bindSelectEvent, getSelectHTML, addColOptionOrCell, setColOption, removeCellOption} from "./select";
import {addFilter, getFiltersHTML, setFilter} from "./filter";
import {addSort, bindSortsEvent, getSortsHTML} from "./sort";
import {bindDateEvent, getDateHTML, setDateValue} from "./date";
import {formatNumber} from "./number";
import {removeAttrViewColAnimation, updateAttrViewCellAnimation} from "./action";
import {addAssetLink, bindAssetEvent, editAssetItem, getAssetHTML, updateAssetCell} from "./asset";
import {Constants} from "../../../constants";
import {hideElements} from "../../ui/hideElements";
import {pathPosix} from "../../../util/pathName";
import {openEmojiPanel, unicode2Emoji} from "../../../emoji";

export const openMenuPanel = (options: {
    protyle: IProtyle,
    blockElement: Element,
    type: "select" | "properties" | "config" | "sorts" | "filters" | "edit" | "date" | "asset",
    colId?: string, // for edit
    cellElements?: HTMLElement[]    // for select & date
}) => {
    let avPanelElement = document.querySelector(".av__panel");
    if (avPanelElement) {
        avPanelElement.remove();
        return;
    }
    window.siyuan.menus.menu.remove();
    const avID = options.blockElement.getAttribute("data-av-id");
    fetchPost("/api/av/renderAttributeView", {
        id: avID,
    }, (response) => {
        const data = response.data as IAV;
        let html;
        if (options.type === "config") {
            html = getConfigHTML(data.view);
        } else if (options.type === "properties") {
            html = getPropertiesHTML(data.view);
        } else if (options.type === "sorts") {
            html = getSortsHTML(data.view.columns, data.view.sorts);
        } else if (options.type === "filters") {
            html = getFiltersHTML(data.view);
        } else if (options.type === "select") {
            html = getSelectHTML(data.view, options.cellElements);
        } else if (options.type === "asset") {
            html = getAssetHTML(data.view, options.cellElements);
        } else if (options.type === "edit") {
            html = getEditHTML({protyle: options.protyle, data, colId: options.colId});
        } else if (options.type === "date") {
            html = getDateHTML(data.view, options.cellElements);
        }

        document.body.insertAdjacentHTML("beforeend", `<div class="av__panel" style="z-index: ${++window.siyuan.zIndex}">
    <div class="b3-dialog__scrim" data-type="close"></div>
    <div class="b3-menu">${html}</div>
</div>`);
        avPanelElement = document.querySelector(".av__panel");
        const menuElement = avPanelElement.lastElementChild as HTMLElement;
        const tabRect = options.blockElement.querySelector(".layout-tab-bar")?.getBoundingClientRect();
        if (["select", "date", "asset"].includes(options.type)) {
            const cellRect = options.cellElements[options.cellElements.length - 1].getBoundingClientRect();
            if (options.type === "select") {
                bindSelectEvent(options.protyle, data, menuElement, options.cellElements);
            } else if (options.type === "date") {
                bindDateEvent({protyle: options.protyle, data, menuElement, cellElements: options.cellElements});
            } else if (options.type === "asset") {
                bindAssetEvent({protyle: options.protyle, data, menuElement, cellElements: options.cellElements});
                setTimeout(() => {
                    setPosition(menuElement, cellRect.left, cellRect.bottom, cellRect.height);
                }, Constants.TIMEOUT_LOAD);  // 等待图片加载
            }
            if (["select", "date"].includes(options.type)) {
                const inputElement = menuElement.querySelector("input");
                inputElement.select();
                inputElement.focus();
                setPosition(menuElement, cellRect.left, cellRect.bottom, cellRect.height);
            }
        } else {
            setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
            if (options.type === "sorts") {
                bindSortsEvent(options.protyle, menuElement, data);
            } else if (options.type === "edit") {
                bindEditEvent({protyle: options.protyle, data, menuElement});
            }
        }
        avPanelElement.addEventListener("dragstart", (event) => {
            window.siyuan.dragElement = event.target as HTMLElement;
            window.siyuan.dragElement.style.opacity = ".1";
            return;
        });
        avPanelElement.addEventListener("drop", (event) => {
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
            const target = event.target as HTMLElement;
            const targetElement = hasClosestByAttribute(target, "draggable", "true");
            if (!targetElement ||
                (!targetElement.classList.contains("dragover__top") && !targetElement.classList.contains("dragover__bottom"))) {
                return;
            }
            let type = "columns";
            const isTop = targetElement.classList.contains("dragover__top");
            if (targetElement.querySelector('[data-type="removeSort"]')) {
                type = "sorts";
            } else if (targetElement.querySelector('[data-type="removeFilter"]')) {
                type = "filters";
            } else if (targetElement.querySelector('[data-type="editAssetItem"]')) {
                type = "assets";
            } else if (targetElement.querySelector('[data-type="setColOption"]')) {
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
                    avID: data.id,
                    data: changeData,
                }], [{
                    action: "updateAttrViewColOptions",
                    id: colId,
                    avID: data.id,
                    data: oldData,
                }]);
                if (options.cellElements) {
                    menuElement.innerHTML = getSelectHTML(data.view, options.cellElements);
                    bindSelectEvent(options.protyle, data, menuElement, options.cellElements);
                } else {
                    menuElement.innerHTML = getEditHTML({
                        protyle: options.protyle,
                        data,
                        colId
                    });
                    bindEditEvent({protyle: options.protyle, data, menuElement});
                }
                return;
            }
            const sourceId = sourceElement.dataset.id;
            const targetId = targetElement.dataset.id;
            if (type === "sorts") {
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
                    data: changeData
                }], [{
                    action: "setAttrViewSorts",
                    avID,
                    data: oldData
                }]);
                menuElement.innerHTML = getSortsHTML(data.view.columns, data.view.sorts);
                bindSortsEvent(options.protyle, menuElement, data);
                return;
            }
            if (type === "filters") {
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
                    data: changeData
                }], [{
                    action: "setAttrViewFilters",
                    avID,
                    data: oldData
                }]);
                menuElement.innerHTML = getFiltersHTML(data.view);
                return;
            }
            if (type === "assets") {
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
                    data,
                    cellElements: options.cellElements,
                    type: "replace",
                    replaceValue
                });
                return;
            }
            transaction(options.protyle, [{
                action: "sortAttrViewCol",
                avID,
                previousID: (targetElement.classList.contains("dragover__top") ? targetElement.previousElementSibling?.getAttribute("data-id") : targetElement.getAttribute("data-id")) || "",
                id: sourceId,
            }], [{
                action: "sortAttrViewCol",
                avID,
                previousID: sourceElement.previousElementSibling?.getAttribute("data-id") || "",
                id: sourceId,
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
            menuElement.innerHTML = getPropertiesHTML(data.view);
        });
        let dragoverElement: HTMLElement;
        avPanelElement.addEventListener("dragover", (event: DragEvent) => {
            const target = event.target as HTMLElement;
            const targetElement = hasClosestByAttribute(target, "draggable", "true");
            if (!targetElement || targetElement.isSameNode(window.siyuan.dragElement)) {
                return;
            }
            event.preventDefault();
            if (dragoverElement && targetElement.isSameNode(dragoverElement)) {
                const nodeRect = targetElement.getBoundingClientRect();
                if (event.clientY > nodeRect.top + nodeRect.height / 2) {
                    targetElement.classList.add("dragover__bottom");
                } else {
                    targetElement.classList.add("dragover__top");
                }
                return;
            }
            dragoverElement = targetElement;
        });
        avPanelElement.addEventListener("dragleave", (event) => {
            const target = event.target as HTMLElement;
            const targetElement = hasClosestByAttribute(target, "draggable", "true");
            if (targetElement) {
                targetElement.classList.remove("dragover__top", "dragover__bottom");
            }
        });
        avPanelElement.addEventListener("dragend", () => {
            if (window.siyuan.dragElement) {
                window.siyuan.dragElement.style.opacity = "";
                window.siyuan.dragElement = undefined;
            }
        });
        avPanelElement.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isSameNode(avPanelElement)) {
                const type = target.dataset.type;
                if (type === "close") {
                    if (options.protyle.toolbar.subElement.className.includes("fn__none")) {
                        avPanelElement.remove();
                    } else {
                        // 优先关闭资源文件搜索
                        hideElements(["util"], options.protyle);
                    }
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goConfig") {
                    menuElement.innerHTML = getConfigHTML(data.view);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goProperties") {
                    menuElement.innerHTML = getPropertiesHTML(data.view);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goSorts") {
                    menuElement.innerHTML = getSortsHTML(data.view.columns, data.view.sorts);
                    bindSortsEvent(options.protyle, menuElement, data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeSorts") {
                    transaction(options.protyle, [{
                        action: "setAttrViewSorts",
                        avID,
                        data: []
                    }], [{
                        action: "setAttrViewSorts",
                        avID,
                        data: data.view.sorts
                    }]);
                    data.view.sorts = [];
                    menuElement.innerHTML = getSortsHTML(data.view.columns, data.view.sorts);
                    bindSortsEvent(options.protyle, menuElement, data);
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
                        protyle: options.protyle
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
                        data: data.view.sorts
                    }], [{
                        action: "setAttrViewSorts",
                        avID,
                        data: oldSorts
                    }]);
                    menuElement.innerHTML = getSortsHTML(data.view.columns, data.view.sorts);
                    bindSortsEvent(options.protyle, menuElement, data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goFilters") {
                    menuElement.innerHTML = getFiltersHTML(data.view);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeFilters") {
                    transaction(options.protyle, [{
                        action: "setAttrViewFilters",
                        avID,
                        data: []
                    }], [{
                        action: "setAttrViewFilters",
                        avID,
                        data: data.view.filters
                    }]);
                    data.view.filters = [];
                    menuElement.innerHTML = getFiltersHTML(data.view);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
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
                        protyle: options.protyle
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeFilter") {
                    window.siyuan.menus.menu.remove();
                    const oldFilters = Object.assign([], data.view.filters);
                    data.view.filters.find((item: IAVFilter, index: number) => {
                        if (item.column === target.parentElement.dataset.id) {
                            data.view.filters.splice(index, 1);
                            return true;
                        }
                    });
                    transaction(options.protyle, [{
                        action: "setAttrViewFilters",
                        avID,
                        data: data.view.filters
                    }], [{
                        action: "setAttrViewFilters",
                        avID,
                        data: oldFilters
                    }]);
                    menuElement.innerHTML = getFiltersHTML(data.view);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "setFilter") {
                    data.view.filters.find((item: IAVFilter) => {
                        if (item.column === target.parentElement.parentElement.dataset.id) {
                            setFilter({
                                filter: item,
                                protyle: options.protyle,
                                data,
                                target
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
                        target.innerHTML = unicode ? unicode2Emoji(unicode) : `<svg><use xlink:href="#${getColIconByType(target.dataset.colType as TAVCol)}"></use></svg>`
                        updateAttrViewCellAnimation(options.blockElement.querySelector(`.av__row--header .av__cell[data-col-id="${colId}"]`))
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
                                data: false
                            });
                            undoOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                avID,
                                data: true
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
                                data: true
                            });
                            undoOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                avID,
                                data: false
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
                        colId: target.parentElement.dataset.id
                    });
                    bindEditEvent({protyle: options.protyle, data, menuElement});
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "hideCol") {
                    const isEdit = menuElement.querySelector('[data-type="goProperties"]');
                    const colId = isEdit ? menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id") : target.parentElement.getAttribute("data-id");
                    transaction(options.protyle, [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        avID,
                        data: true
                    }], [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        avID,
                        data: false
                    }]);
                    data.view.columns.find((item: IAVColumn) => item.id === colId).hidden = true;
                    if (isEdit) {
                        menuElement.innerHTML = getEditHTML({
                            protyle: options.protyle,
                            data,
                            colId
                        });
                        bindEditEvent({protyle: options.protyle, data, menuElement});
                    } else {
                        menuElement.innerHTML = getPropertiesHTML(data.view);
                    }
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "showCol") {
                    const isEdit = menuElement.querySelector('[data-type="goProperties"]');
                    const colId = isEdit ? menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id") : target.parentElement.getAttribute("data-id");
                    transaction(options.protyle, [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        avID,
                        data: false
                    }], [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        avID,
                        data: true
                    }]);
                    data.view.columns.find((item: IAVColumn) => item.id === colId).hidden = false;
                    if (isEdit) {
                        menuElement.innerHTML = getEditHTML({
                            protyle: options.protyle,
                            data,
                            colId
                        });
                        bindEditEvent({protyle: options.protyle, data, menuElement});
                    } else {
                        menuElement.innerHTML = getPropertiesHTML(data.view);
                    }
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "duplicateCol") {
                    const colId = menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
                    const colData = data.view.columns.find((item: IAVColumn) => item.id === colId);
                    duplicateCol({
                        protyle: options.protyle,
                        type: colData.type,
                        avID,
                        colId,
                        icon: colData.icon,
                        newValue: colData.name
                    });
                    avPanelElement.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeCol") {
                    const colId = menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
                    const colData = data.view.columns.find((item: IAVColumn) => item.id === colId);
                    transaction(options.protyle, [{
                        action: "removeAttrViewCol",
                        id: colId,
                        avID,
                    }], [{
                        action: "addAttrViewCol",
                        name: colData.name,
                        avID,
                        type: colData.type,
                        id: colId
                    }]);
                    removeAttrViewColAnimation(options.blockElement, colId);
                    avPanelElement.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "setColOption") {
                    setColOption(options.protyle, data, target, options.cellElements);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "addColOptionOrCell") {
                    addColOptionOrCell(options.protyle, data, options.cellElements, target, menuElement);
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeCellOption") {
                    removeCellOption(options.protyle, data, options.cellElements, target.parentElement);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "addAssetLink") {
                    addAssetLink(options.protyle, data, options.cellElements, target);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "addAssetExist") {
                    const rect = target.getBoundingClientRect();
                    options.protyle.toolbar.showAssets(options.protyle, {
                        x: rect.right,
                        y: rect.bottom,
                        w: target.parentElement.clientWidth + 8,
                        h: rect.height
                    }, (url) => {
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
                                name: pathPosix().basename(url).substring(0, Constants.SIZE_LINK_TEXT_MAX)
                            };
                        }
                        updateAssetCell({
                            protyle: options.protyle,
                            data,
                            cellElements: options.cellElements,
                            type: "addUpdate",
                            addUpdateValue: [value]
                        });
                        hideElements(["util"], options.protyle);
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "editAssetItem") {
                    editAssetItem(options.protyle, data, options.cellElements, target.parentElement);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "clearDate") {
                    setDateValue({
                        cellElements: options.cellElements,
                        data,
                        protyle: options.protyle,
                        value: {
                            isNotEmpty2: false,
                            isNotEmpty: false,
                            content: null,
                            content2: null,
                            hasEndDate: false
                        }
                    });
                    avPanelElement.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
        });
    });
};

const getPropertiesHTML = (data: IAVTable) => {
    let showHTML = "";
    let hideHTML = "";
    data.columns.forEach((item: IAVColumn) => {
        if (item.hidden) {
            hideHTML += `<button class="b3-menu__item" draggable="true" data-id="${item.id}">
    <svg class="b3-menu__icon"><use xlink:href="#iconDrag"></use></svg>
    <div class="fn__flex-1">
        <span class="b3-chip">
            ${item.icon ? unicode2Emoji(item.icon, "icon", true) : `<svg class="icon"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>`}
            <span class="fn__ellipsis">${item.name}</span>
        </span>
    </div>
    <svg class="b3-menu__action" data-type="showCol"><use xlink:href="#iconEyeoff"></use></svg>
    <svg class="b3-menu__action" data-type="editCol"><use xlink:href="#iconEdit"></use></svg>
</button>`;
        } else {
            showHTML += `<button class="b3-menu__item" draggable="true" data-id="${item.id}">
    <svg class="b3-menu__icon"><use xlink:href="#iconDrag"></use></svg>
    <div class="fn__flex-1">
        <span class="b3-chip">
            ${item.icon ? unicode2Emoji(item.icon, "icon", true) : `<svg class="icon"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>`}
            <span class="fn__ellipsis">${item.name}</span>
        </span>
    </div>
    <svg class="b3-menu__action${item.type === "block" ? " fn__none" : ""}" data-type="hideCol"><use xlink:href="#iconEye"></use></svg>
    <svg class="b3-menu__action${item.type === "block" ? " fn__none" : ""}" data-type="editCol"><use xlink:href="#iconEdit"></use></svg>
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
    <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="goConfig">
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

const getConfigHTML = (data: IAVTable) => {
    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label ft__center">${window.siyuan.languages.config}</span>
</button>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="goProperties">
    <svg class="b3-menu__icon"></svg>
    <span class="b3-menu__label">${window.siyuan.languages.attr}</span>
    <span class="b3-menu__accelerator">${data.columns.filter((item: IAVColumn) => !item.hidden).length}/${data.columns.length}</span>
    <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="goFilters">
    <svg class="b3-menu__icon"><use xlink:href="#iconFilter"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.filter}</span>
    <span class="b3-menu__accelerator">${data.filters.length}</span>
    <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="goSorts">
    <svg class="b3-menu__icon"><use xlink:href="#iconSort"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.sort}</span>
    <span class="b3-menu__accelerator">${data.sorts.length}</span>
    <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item">
    <svg class="b3-menu__icon"></svg>
    <span class="b3-menu__label">${window.siyuan.languages.pageCount}</span>
    <span class="b3-menu__accelerator">50</span>
    <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
</button>
</div>`;
};
