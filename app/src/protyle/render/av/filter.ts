import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {hasClosestByClassName} from "../../util/hasClosest";
import {getColIconByType} from "./col";
import {setPosition} from "../../../util/setPosition";

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
                        };
                    } else {
                        cellValue = {};
                    }
                } else {
                    cellValue = {
                        content: textElement.value
                    };
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

export const addFilter = (options: {
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
                    let cellValue = {};
                    if (column.type !== "number") {
                        cellValue = {content: ""};
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

export const getFiltersHTML = (data: IAV) => {
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
        html += `<button class="b3-menu__item" draggable="true" data-id="${item.column}">
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
