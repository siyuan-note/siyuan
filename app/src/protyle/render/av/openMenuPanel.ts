import {transaction} from "../../wysiwyg/transaction";
import {fetchPost} from "../../../util/fetch";
import {addCol} from "./addCol";
import {getColIconByType} from "./col";
import {setPosition} from "../../../util/setPosition";
import {hasClosestByAttribute} from "../../util/hasClosest";
import {bindSelectEvent, getSelectHTML, addSelectColAndCell, setSelectCol, removeSelectCell} from "./select";
import {addFilter, getFiltersHTML, setFilter} from "./filter";
import {addSort, bindSortsEvent, getSortsHTML} from "./sort";

export const openMenuPanel = (protyle: IProtyle,
                              blockElement: HTMLElement,
                              type: "select" | "properties" | "config" | "sorts" | "filters" = "config",
                              options?: any) => {
    let avPanelElement = document.querySelector(".av__panel");
    if (avPanelElement) {
        avPanelElement.remove();
        return;
    }
    window.siyuan.menus.menu.remove();
    const avId = blockElement.getAttribute("data-av-id");
    fetchPost("/api/av/renderAttributeView", {id: avId}, (response) => {
        const data = response.data.av as IAV;
        let html;
        if (type === "config") {
            html = getConfigHTML(data);
        } else if (type === "properties") {
            html = getPropertiesHTML(data);
        } else if (type === "sorts") {
            html = getSortsHTML(data);
        } else if (type === "filters") {
            html = getFiltersHTML(data);
        } else if (type === "select") {
            html = getSelectHTML(data, options);
        }

        document.body.insertAdjacentHTML("beforeend", `<div class="av__panel">
    <div class="b3-dialog__scrim" data-type="close"></div>
    <div class="b3-menu">${html}</div>
</div>`);
        avPanelElement = document.querySelector(".av__panel");
        const menuElement = avPanelElement.lastElementChild as HTMLElement;
        const tabRect = blockElement.querySelector(".layout-tab-bar").getBoundingClientRect();
        if (options && options.cellElement) {
            const cellRect = options.cellElement.getBoundingClientRect();
            setPosition(menuElement, cellRect.left, cellRect.bottom, cellRect.height);
            bindSelectEvent(protyle, data, menuElement, options);
            menuElement.querySelector("input").select();
            menuElement.querySelector("input").focus();
        } else {
            setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
        }

        bindSortsEvent(protyle, menuElement, data);
        avPanelElement.addEventListener("dragstart", (event) => {
            window.siyuan.dragElement = event.target as HTMLElement;
            window.siyuan.dragElement.style.opacity = ".1";
            return;
        });
        avPanelElement.addEventListener("drop", (event) => {
            window.siyuan.dragElement.style.opacity = "";
            const sourceElement = window.siyuan.dragElement;
            window.siyuan.dragElement = undefined;
            if (protyle.disabled) {
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
            } else if (targetElement.querySelector('[data-type="setSelectCol"]')) {
                const changeData = data.columns.find((column) => column.id === options.cellElement.dataset.colId).options;
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
                transaction(protyle, [{
                    action: "updateAttrViewColOptions",
                    id: options.cellElement.dataset.colId,
                    parentID: data.id,
                    data: changeData,
                }], [{
                    action: "updateAttrViewColOptions",
                    id: options.cellElement.dataset.colId,
                    parentID: data.id,
                    data: oldData,
                }]);
                menuElement.innerHTML = getSelectHTML(data, options);
                bindSelectEvent(protyle, data, menuElement, options);
                return;
            }
            const sourceId = sourceElement.dataset.id;
            const targetId = targetElement.dataset.id;
            if (type !== "columns") {
                const changeData = (type === "sorts" ? data.sorts : data.filters) as IAVFilter[];
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

                transaction(protyle, [{
                    action: "setAttrView",
                    id: avId,
                    data: {
                        [type]: changeData
                    }
                }], [{
                    action: "setAttrView",
                    id: avId,
                    data: {
                        [type]: oldData
                    }
                }]);
                menuElement.innerHTML = (type === "sorts" ? getSortsHTML(data) : getFiltersHTML(data));
                if (type === "sorts") {
                    bindSortsEvent(protyle, menuElement, data);
                }
                return;
            }
            transaction(protyle, [{
                action: "sortAttrViewCol",
                parentID: avId,
                previousID: (targetElement.classList.contains("dragover__top") ? targetElement.previousElementSibling?.getAttribute("data-id") : targetElement.getAttribute("data-id")) || "",
                id: sourceId,
            }], [{
                action: "sortAttrViewCol",
                parentID: avId,
                previousID: sourceElement.previousElementSibling?.getAttribute("data-id") || "",
                id: sourceId,
            }]);
            let column: IAVColumn;
            data.columns.find((item, index: number) => {
                if (item.id === sourceId) {
                    column = data.columns.splice(index, 1)[0];
                    return true;
                }
            });
            data.columns.find((item, index: number) => {
                if (item.id === targetId) {
                    if (isTop) {
                        data.columns.splice(index, 0, column);
                    } else {
                        data.columns.splice(index + 1, 0, column);
                    }
                    return true;
                }
            });
            menuElement.innerHTML = getPropertiesHTML(data);
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
            event.preventDefault();
            let target = event.target as HTMLElement;
            while (target && !target.isSameNode(avPanelElement)) {
                const type = target.dataset.type;
                if (type === "close") {
                    avPanelElement.remove();
                    window.siyuan.menus.menu.remove();
                    event.stopPropagation();
                    break;
                } else if (type === "goConfig") {
                    menuElement.innerHTML = getConfigHTML(data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.stopPropagation();
                    break;
                } else if (type === "goProperties") {
                    menuElement.innerHTML = getPropertiesHTML(data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.stopPropagation();
                    break;
                } else if (type === "goSorts") {
                    menuElement.innerHTML = getSortsHTML(data);
                    bindSortsEvent(protyle, menuElement, data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.stopPropagation();
                    break;
                } else if (type === "removeSorts") {
                    transaction(protyle, [{
                        action: "setAttrView",
                        id: avId,
                        data: {
                            sorts: []
                        }
                    }], [{
                        action: "setAttrView",
                        id: avId,
                        data: {
                            sorts: data.sorts
                        }
                    }]);
                    data.sorts = [];
                    menuElement.innerHTML = getSortsHTML(data);
                    bindSortsEvent(protyle, menuElement, data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.stopPropagation();
                    break;
                } else if (type === "addSort") {
                    addSort({data, rect: target.getBoundingClientRect(), menuElement, tabRect, avId, protyle});
                    event.stopPropagation();
                    break;
                } else if (type === "removeSort") {
                    const oldSorts = Object.assign([], data.sorts);
                    data.sorts.find((item: IAVSort, index: number) => {
                        if (item.column === target.parentElement.dataset.id) {
                            data.sorts.splice(index, 1);
                            return true;
                        }
                    });
                    transaction(protyle, [{
                        action: "setAttrView",
                        id: avId,
                        data: {
                            sorts: data.sorts
                        }
                    }], [{
                        action: "setAttrView",
                        id: avId,
                        data: {
                            sorts: oldSorts
                        }
                    }]);
                    menuElement.innerHTML = getSortsHTML(data);
                    bindSortsEvent(protyle, menuElement, data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.stopPropagation();
                    break;
                } else if (type === "goFilters") {
                    menuElement.innerHTML = getFiltersHTML(data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.stopPropagation();
                    break;
                } else if (type === "removeFilters") {
                    transaction(protyle, [{
                        action: "setAttrView",
                        id: avId,
                        data: {
                            filters: []
                        }
                    }], [{
                        action: "setAttrView",
                        id: avId,
                        data: {
                            filters: data.filters
                        }
                    }]);
                    data.filters = [];
                    menuElement.innerHTML = getFiltersHTML(data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.stopPropagation();
                    break;
                } else if (type === "addFilter") {
                    addFilter({data, rect: target.getBoundingClientRect(), menuElement, tabRect, avId, protyle});
                    event.stopPropagation();
                    break;
                } else if (type === "removeFilter") {
                    window.siyuan.menus.menu.remove();
                    const oldFilters = Object.assign([], data.filters);
                    data.filters.find((item: IAVFilter, index: number) => {
                        if (item.column === target.parentElement.dataset.id) {
                            data.filters.splice(index, 1);
                            return true;
                        }
                    });
                    transaction(protyle, [{
                        action: "setAttrView",
                        id: avId,
                        data: {
                            filters: data.filters
                        }
                    }], [{
                        action: "setAttrView",
                        id: avId,
                        data: {
                            filters: oldFilters
                        }
                    }]);
                    menuElement.innerHTML = getFiltersHTML(data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.stopPropagation();
                    break;
                } else if (type === "setFilter") {
                    data.filters.find((item: IAVFilter) => {
                        if (item.column === target.parentElement.parentElement.dataset.id) {
                            setFilter({
                                filter: item,
                                protyle,
                                data,
                                target
                            });
                            return true;
                        }
                    })
                    event.stopPropagation();
                    break;
                } else if (type === "newCol") {
                    avPanelElement.remove();
                    const addMenu = addCol(protyle, blockElement);
                    addMenu.open({
                        x: tabRect.right,
                        y: tabRect.bottom,
                        h: tabRect.height,
                        isLeft: true
                    });
                    event.stopPropagation();
                    break;
                } else if (type === "showAllCol") {
                    const doOperations: IOperation[] = [];
                    const undoOperations: IOperation[] = [];
                    data.columns.forEach((item: IAVColumn) => {
                        if (item.hidden) {
                            doOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                parentID: avId,
                                data: false
                            });
                            undoOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                parentID: avId,
                                data: true
                            });
                            item.hidden = false;
                        }
                    });
                    if (doOperations.length > 0) {
                        transaction(protyle, doOperations, undoOperations);
                        menuElement.innerHTML = getPropertiesHTML(data);
                        setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    }
                    event.stopPropagation();
                    break;
                } else if (type === "hideAllCol") {
                    const doOperations: IOperation[] = [];
                    const undoOperations: IOperation[] = [];
                    data.columns.forEach((item: IAVColumn) => {
                        if (!item.hidden && item.type !== "block") {
                            doOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                parentID: avId,
                                data: true
                            });
                            undoOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                parentID: avId,
                                data: false
                            });
                            item.hidden = true;
                        }
                    });
                    if (doOperations.length > 0) {
                        transaction(protyle, doOperations, undoOperations);
                        menuElement.innerHTML = getPropertiesHTML(data);
                        setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    }
                    event.stopPropagation();
                    break;
                } else if (type === "hideCol") {
                    const colId = target.parentElement.getAttribute("data-id");
                    transaction(protyle, [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        parentID: avId,
                        data: true
                    }], [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        parentID: avId,
                        data: false
                    }]);
                    data.columns.find((item: IAVColumn) => item.id === colId).hidden = true;
                    menuElement.innerHTML = getPropertiesHTML(data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.stopPropagation();
                    break;
                } else if (type === "showCol") {
                    const colId = target.parentElement.getAttribute("data-id");
                    transaction(protyle, [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        parentID: avId,
                        data: false
                    }], [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        parentID: avId,
                        data: true
                    }]);
                    data.columns.find((item: IAVColumn) => item.id === colId).hidden = false;
                    menuElement.innerHTML = getPropertiesHTML(data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.stopPropagation();
                    break;
                } else if (type === "setSelectCol") {
                    setSelectCol(protyle, data, options, target);
                    event.stopPropagation();
                    break;
                } else if (type === "addSelectColAndCell") {
                    addSelectColAndCell(protyle, data, options, target, menuElement);
                    window.siyuan.menus.menu.remove();
                    event.stopPropagation();
                    break;
                } else if (type === "removeSelectCell") {
                    removeSelectCell(protyle, data, options, target.parentElement);
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
        });
    });
};

const getPropertiesHTML = (data: IAV) => {
    let showHTML = "";
    let hideHTML = "";
    data.columns.forEach((item: IAVColumn) => {
        if (item.hidden) {
            hideHTML += `<button class="b3-menu__item" draggable="true" data-id="${item.id}">
    <svg class="b3-menu__icon"><use xlink:href="#iconDrag"></use></svg>
    <div class="fn__flex-1">
        <span class="b3-chip">
            <svg><use xlink:href="#${getColIconByType(item.type)}"></use></svg>
            <span class="fn__ellipsis">${item.name}</span>
        </span>
    </div>
    <svg class="b3-menu__action" data-type="showCol"><use xlink:href="#iconEyeoff"></use></svg>
    <svg class="b3-menu__action"><use xlink:href="#iconEdit"></use></svg>
</button>`;
        } else {
            showHTML += `<button class="b3-menu__item" draggable="true" data-id="${item.id}">
    <svg class="b3-menu__icon"><use xlink:href="#iconDrag"></use></svg>
    <div class="fn__flex-1">
        <span class="b3-chip">
            <svg><use xlink:href="#${getColIconByType(item.type)}"></use></svg>
            <span class="fn__ellipsis">${item.name}</span>
        </span>
    </div>
    <svg class="b3-menu__action${item.type === "block" ? " fn__none" : ""}" data-type="hideCol"><use xlink:href="#iconEye"></use></svg>
    <svg class="b3-menu__action${item.type === "block" ? " fn__none" : ""}"><use xlink:href="#iconEdit"></use></svg>
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
    return `<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="goConfig">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages.attr}</span>
    <svg class="b3-menu__action" data-type="close" style="opacity: 1"><use xlink:href="#iconCloseRound"></use></svg>
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
</button>`;
};

const getConfigHTML = (data: IAV) => {
    return `<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label">${window.siyuan.languages.config}</span>
    <svg class="b3-menu__action" data-type="close" style="opacity: 1"><use xlink:href="#iconCloseRound"></use></svg>
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
</button>`;
};
