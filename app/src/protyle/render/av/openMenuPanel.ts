import {transaction} from "../../wysiwyg/transaction";
import {fetchPost} from "../../../util/fetch";
import {addCol} from "./addCol";
import {getColIconByType} from "./col";
import {setPosition} from "../../../util/setPosition";
import {Menu} from "../../../plugin/Menu";
import {hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";

export const openMenuPanel = (protyle: IProtyle, blockElement: HTMLElement, type: "properties" | "config" | "sorts" | "filters" = "config") => {
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
        }
        document.body.insertAdjacentHTML("beforeend", `<div class="av__panel">
    <div class="b3-dialog__scrim" data-type="close"></div>
    <div class="b3-menu">${html}</div>
</div>`);

        avPanelElement = document.querySelector(".av__panel");
        const menuElement = avPanelElement.lastElementChild as HTMLElement;
        const tabRect = blockElement.querySelector(".layout-tab-bar").getBoundingClientRect();
        setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);

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
            const targetElement = hasClosestByAttribute(target, "data-id", null);
            if (!targetElement ||
                (!targetElement.classList.contains("dragover__top") && !targetElement.classList.contains("dragover__bottom"))) {
                return;
            }
            let type = "columns";
            if (targetElement.querySelector('[data-type="removeSort"]')) {
                type = "sorts";
            } else if (targetElement.querySelector('[data-type="removeFilter"]')) {
                type = "filters";
            }
            const sourceId = sourceElement.dataset.id;
            const targetId = targetElement.dataset.id;
            const isTop = targetElement.classList.contains("dragover__top")
            if (type !== "columns") {
                const changeData = (type === "sorts" ? data.sorts : data.filters) as IAVFilter[]
                const oldData = Object.assign([], changeData);
                let targetFilter: IAVFilter
                changeData.find((filter, index: number) => {
                    if (filter.column === sourceId) {
                        targetFilter = changeData.splice(index, 1)[0];
                        return true;
                    }
                })
                changeData.find((filter, index: number) => {
                    if (filter.column === targetId) {
                        if (isTop) {
                            changeData.splice(index, 0, targetFilter);
                        } else {
                            changeData.splice(index + 1, 0, targetFilter);
                        }
                        return true;
                    }
                })

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
            let column: IAVColumn
            data.columns.find((item, index: number) => {
                if (item.id === sourceId) {
                    column = data.columns.splice(index, 1)[0];
                    return true;
                }
            })
            data.columns.find((item, index: number) => {
                if (item.id === targetId) {
                    if (isTop) {
                        data.columns.splice(index, 0, column);
                    } else {
                        data.columns.splice(index + 1, 0, column);
                    }
                    return true;
                }
            })
            menuElement.innerHTML = getPropertiesHTML(data)
        });
        let dragoverElement: HTMLElement
        avPanelElement.addEventListener("dragover", (event: DragEvent) => {
            const target = event.target as HTMLElement;
            const targetElement = hasClosestByAttribute(target, "data-id", null);
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
            const targetElement = hasClosestByAttribute(target, "data-id", null);
            if (targetElement) {
                targetElement.classList.remove("dragover__top", "dragover__bottom");
            }
        });
        avPanelElement.addEventListener("dragend", (event) => {
            if (window.siyuan.dragElement) {
                window.siyuan.dragElement.style.opacity = ""
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
                    const colType = target.getAttribute("data-coltype") as TAVCol;
                    setFilter({
                        filter: {
                            operator: target.dataset.op as TAVFilterOperator,
                            column: target.parentElement.parentElement.dataset.id,
                            value: {
                                [colType]: {content: target.dataset.value}
                            }
                        },
                        protyle,
                        data,
                        target
                    });
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
                }
                target = target.parentElement;
            }
        });
    });
};

const addSort = (options: {
    data: IAV,
    rect: DOMRect,
    menuElement: HTMLElement,
    tabRect: DOMRect,
    avId: string,
    protyle: IProtyle
}) => {
    const menu = new Menu("av-add-sort");
    options.data.columns.forEach((column) => {
        let hasSort = false;
        options.data.sorts.find((sort) => {
            if (sort.column === column.id) {
                hasSort = true;
                return true;
            }
        });
        if (!hasSort) {
            menu.addItem({
                label: column.name,
                icon: getColIconByType(column.type),
                click: () => {
                    const oldSorts = Object.assign([], options.data.sorts);
                    options.data.sorts.push({
                        column: column.id,
                        order: "ASC",
                    });
                    transaction(options.protyle, [{
                        action: "setAttrView",
                        id: options.avId,
                        data: {
                            sorts: options.data.sorts
                        }
                    }], [{
                        action: "setAttrView",
                        id: options.avId,
                        data: {
                            sorts: oldSorts
                        }
                    }]);
                    options.menuElement.innerHTML = getSortsHTML(options.data);
                    bindSortsEvent(options.protyle, options.menuElement, options.data);
                    setPosition(options.menuElement, options.tabRect.right - options.menuElement.clientWidth, options.tabRect.bottom, options.tabRect.height);
                }
            });
        }
    });
    menu.open({
        x: options.rect.left,
        y: options.rect.bottom,
        h: options.rect.height,
    });
};

const bindSortsEvent = (protyle: IProtyle, menuElement: HTMLElement, data: IAV) => {
    menuElement.querySelectorAll("select").forEach((item: HTMLSelectElement) => {
        item.addEventListener("change", () => {
            const colId = item.parentElement.getAttribute("data-id");
            const oldSort = JSON.parse(JSON.stringify(data.sorts));
            if (item.previousElementSibling.classList.contains("b3-menu__icon")) {
                data.sorts.find((sort: IAVSort) => {
                    if (sort.column === colId) {
                        sort.column = item.value;
                        item.parentElement.setAttribute("data-id", item.value);
                        return true;
                    }
                });
            } else {
                data.sorts.find((sort: IAVSort) => sort.column === colId).order = item.value as "ASC" | "DESC";
            }
            transaction(protyle, [{
                action: "setAttrView",
                id: data.id,
                data: {
                    sorts: data.sorts
                }
            }], [{
                action: "setAttrView",
                id: data.id,
                data: {
                    sorts: oldSort
                }
            }]);
        });
    });
};

const getSortsHTML = (data: IAV) => {
    let html = "";
    const genSortItem = (id: string) => {
        let sortHTML = "";
        data.columns.forEach((item) => {
            sortHTML += `<option value="${item.id}" ${item.id === id ? "selected" : ""}>${item.name}</option>`;
        });
        return sortHTML;
    };
    data.sorts.forEach((item: IAVSort) => {
        html += `<button draggable="true" class="b3-menu__item" data-id="${item.column}">
    <svg class="b3-menu__icon"><use xlink:href="#iconDrag"></use></svg>
    <select class="b3-select" style="width: 106px;margin: 4px 0">
        ${genSortItem(item.column)}
    </select>
    <span class="fn__space"></span>
    <select class="b3-select" style="width: 106px;margin: 4px 0">
        <option value="ASC" ${item.order === "ASC" ? "selected" : ""}>${window.siyuan.languages.asc}</option>
        <option value="DESC" ${item.order === "DESC" ? "selected" : ""}>${window.siyuan.languages.desc}</option>
    </select>
    <svg class="b3-menu__action" data-type="removeSort"><use xlink:href="#iconTrashcan"></use></svg>
</button>`;
    });
    return `<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="goConfig">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages.sort}</span>
    <svg class="b3-menu__action" data-type="close" style="opacity: 1"><use xlink:href="#iconCloseRound"></use></svg>
</button>
<button class="b3-menu__separator"></button>
${html}
<button class="b3-menu__item${data.sorts.length === data.columns.length ? " fn__none" : ""}" data-type="addSort">
    <svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.new}</span>
</button>
<button class="b3-menu__item${html ? "" : " fn__none"}" data-type="removeSorts">
    <svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.delete}</span>
</button>`;
};

export const setFilter = (options: {
    filter: IAVFilter,
    protyle: IProtyle,
    data: IAV,
    target: HTMLElement,
}) => {
    const colType = Object.keys(options.filter.value)[0] as TAVCol;
    const rectTarget = options.target.getBoundingClientRect();
    const menu = new Menu("set-filter-" + options.filter.column, () => {
        const oldFilters = JSON.parse(JSON.stringify(options.data.filters));
        options.data.filters.find((filter) => {
            if (filter.column === options.filter.column) {
                let cellValue: IAVCellValue;
                if (colType === "number") {
                    if (textElement.value) {
                        cellValue = {
                            content: parseFloat(textElement.value),
                            isNotEmpty: true
                        }
                    } else {
                        cellValue = {}
                    }
                } else {
                    cellValue = {
                        content: textElement.value
                    }
                }
                filter.value[colType] = cellValue;
                filter.operator = (window.siyuan.menus.menu.element.querySelector(".b3-select") as HTMLSelectElement).value as TAVFilterOperator;
                return true;
            }
        });
        transaction(options.protyle, [{
            action: "setAttrView",
            id: options.data.id,
            data: {
                filters: options.data.filters
            }
        }], [{
            action: "setAttrView",
            id: options.data.id,
            data: {
                filters: oldFilters
            }
        }]);
        const menuElement = hasClosestByClassName(options.target, "b3-menu");
        if (menuElement) {
            menuElement.innerHTML = getFiltersHTML(options.data);
        }
    });
    if (menu.isOpen) {
        return;
    }
    let selectHTML = "";
    switch (colType) {
        case "text":
            selectHTML = `<option ${"=" === options.filter.operator ? "selected" : ""} value="=">${window.siyuan.languages.filterOperatorIs}</option>
<option ${"!=" === options.filter.operator ? "selected" : ""} value="!=">${window.siyuan.languages.filterOperatorIsNot}</option>
<option ${"Contains" === options.filter.operator ? "selected" : ""} value="Contains">${window.siyuan.languages.filterOperatorContains}</option>
<option ${"Does not contains" === options.filter.operator ? "selected" : ""} value="Does not contains">${window.siyuan.languages.filterOperatorDoesNotContain}</option>
<option ${"Starts with" === options.filter.operator ? "selected" : ""} value="Starts with">${window.siyuan.languages.filterOperatorStartsWith}</option>
<option ${"Ends with" === options.filter.operator ? "selected" : ""} value="Ends with">${window.siyuan.languages.filterOperatorEndsWith}</option>
<option ${"Is empty" === options.filter.operator ? "selected" : ""} value="Is empty">${window.siyuan.languages.filterOperatorIsEmpty}</option>
<option ${"Is not empty" === options.filter.operator ? "selected" : ""} value="Is not empty">${window.siyuan.languages.filterOperatorIsNotEmpty}</option>
`;
            break;
        case "number":
            selectHTML = `<option ${"=" === options.filter.operator ? "selected" : ""} value="=">=</option>
<option ${"!=" === options.filter.operator ? "selected" : ""} value="!=">!=</option>
<option ${">" === options.filter.operator ? "selected" : ""} value=">">&gt;</option>
<option ${"<" === options.filter.operator ? "selected" : ""} value="<">&lt;</option>
<option ${">=" === options.filter.operator ? "selected" : ""} value=">=">&GreaterEqual;</option>
<option ${"<=" === options.filter.operator ? "selected" : ""} value="<=">&le;</option>
<option ${"Is empty" === options.filter.operator ? "selected" : ""} value="Is empty">${window.siyuan.languages.filterOperatorIsEmpty}</option>
<option ${"Is not empty" === options.filter.operator ? "selected" : ""} value="Is not empty">${window.siyuan.languages.filterOperatorIsNotEmpty}</option>
`;
            break;
    }
    menu.addItem({
        iconHTML: "",
        label: `<select style="margin: 4px 0" class="b3-select fn__size200">${selectHTML}</select>`
    });
    menu.addItem({
        iconHTML: "",
        label: `<input style="margin: 4px 0" value="${options.filter.value[colType].content}" class="b3-text-field fn__size200">`
    });
    const textElement = (window.siyuan.menus.menu.element.querySelector(".b3-text-field") as HTMLInputElement);
    textElement.addEventListener("keydown", (event) => {
        if (event.isComposing) {
            event.preventDefault();
            return;
        }
        if (event.key === "Enter") {
            menu.close();
            event.preventDefault();
        }
    });
    menu.open({x: rectTarget.left, y: rectTarget.bottom});
    textElement.select();
};

const addFilter = (options: {
    data: IAV,
    rect: DOMRect,
    menuElement: HTMLElement,
    tabRect: DOMRect,
    avId: string,
    protyle: IProtyle
}) => {
    const menu = new Menu("av-add-filter");
    options.data.columns.forEach((column) => {
        let hasFilter = false;
        options.data.filters.find((filter) => {
            if (filter.column === column.id) {
                hasFilter = true;
                return true;
            }
        });
        if (!hasFilter) {
            menu.addItem({
                label: column.name,
                icon: getColIconByType(column.type),
                click: () => {
                    const oldFilters = Object.assign([], options.data.filters);
                    let cellValue = {}
                    if (column.type !== "number") {
                        cellValue = {content: ""}
                    }
                    options.data.filters.push({
                        column: column.id,
                        operator: "Contains",
                        value: {
                            [column.type]: cellValue
                        },
                    });
                    transaction(options.protyle, [{
                        action: "setAttrView",
                        id: options.avId,
                        data: {
                            filters: options.data.filters
                        }
                    }], [{
                        action: "setAttrView",
                        id: options.avId,
                        data: {
                            filters: oldFilters
                        }
                    }]);
                    options.menuElement.innerHTML = getFiltersHTML(options.data);
                    setPosition(options.menuElement, options.tabRect.right - options.menuElement.clientWidth, options.tabRect.bottom, options.tabRect.height);
                    const filterElement = options.menuElement.querySelector(`[data-id="${column.id}"] .b3-chip`) as HTMLElement;
                    const colType = filterElement.getAttribute("data-coltype") as TAVCol;
                    setFilter({
                        filter: {
                            operator: filterElement.dataset.op as TAVFilterOperator,
                            column: filterElement.parentElement.parentElement.dataset.id,
                            value: {
                                [colType]: {content: filterElement.dataset.value}
                            }
                        },
                        protyle: options.protyle,
                        data: options.data,
                        target: filterElement
                    });
                }
            });
        }
    });
    menu.open({
        x: options.rect.left,
        y: options.rect.bottom,
        h: options.rect.height,
    });
};

const getFiltersHTML = (data: IAV) => {
    let html = "";
    const genFilterItem = (filter: IAVFilter) => {
        let filterHTML = "";
        data.columns.find((item) => {
            if (item.id === filter.column) {
                const filterValue = (filter.value && filter.value[item.type] && filter.value[item.type].content) ? filter.value[item.type].content : "";
                filterHTML += `<span data-type="setFilter" data-coltype="${item.type}" data-op="${filter.operator}" data-value="${filterValue}" class="b3-chip${filterValue ? " b3-chip--primary" : ""}">
    <svg><use xlink:href="#${getColIconByType(item.type)}"></use></svg>
    <span class="fn__ellipsis">${item.name}${filterValue ? ": " + filterValue : ""}</span>
</span>`;
                return true;
            }
        });
        return filterHTML;
    };
    data.filters.forEach((item: IAVFilter) => {
        html += `<button class="b3-menu__item" draggable="true" data-type="nobg" data-id="${item.column}">
    <svg class="b3-menu__icon"><use xlink:href="#iconDrag"></use></svg>
    <div class="fn__flex-1">${genFilterItem(item)}</div>
    <svg class="b3-menu__action" data-type="removeFilter"><use xlink:href="#iconTrashcan"></use></svg>
</button>`;
    });
    return `<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="goConfig">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages.filter}</span>
    <svg class="b3-menu__action" data-type="close" style="opacity: 1"><use xlink:href="#iconCloseRound"></use></svg>
</button>
<button class="b3-menu__separator"></button>
${html}
<button class="b3-menu__item${data.filters.length === data.columns.length ? " fn__none" : ""}" data-type="addFilter">
    <svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.new}</span>
</button>
<button class="b3-menu__item${html ? "" : " fn__none"}" data-type="removeFilters">
    <svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.delete}</span>
</button>`;
};

const getPropertiesHTML = (data: IAV) => {
    let showHTML = "";
    let hideHTML = "";
    data.columns.forEach((item: IAVColumn) => {
        if (item.hidden) {
            hideHTML += `<button class="b3-menu__item" draggable="true" data-type="nobg" data-id="${item.id}">
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
            showHTML += `<button class="b3-menu__item" draggable="true" data-type="nobg" data-id="${item.id}">
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
