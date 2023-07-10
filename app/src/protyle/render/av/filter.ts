import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {hasClosestByClassName} from "../../util/hasClosest";
import {getColIconByType} from "./col";
import {setPosition} from "../../../util/setPosition";
import {objEquals} from "../../../util/functions";

export const getCellValue = (colType: TAVCol, value: string) => {
    let cellValue: IAVCellValue;
    if (colType === "number") {
        if (value) {
            cellValue = {
                number: {
                    content: parseFloat(value),
                    isNotEmpty: true
                }
            };
        } else {
            cellValue = {
                number: {
                    isNotEmpty: false
                }
            };
        }
    } else if (colType === "text") {
        cellValue = {
            text: {
                content: value
            }
        };
    } else if (colType === "mSelect" || colType === "select") {
        cellValue = {
            mSelect: [{
                content: value,
                color: ""
            }]
        };
    }
    return cellValue;
}

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
        let hasMatch = false;
        const cellValue = getCellValue(colType, textElement?.value || "");
        const newFilter: IAVFilter = {
            column: options.filter.column,
            value: cellValue,
            operator: (window.siyuan.menus.menu.element.querySelector(".b3-select") as HTMLSelectElement).value as TAVFilterOperator
        }

        let isSame = false;
        options.data.filters.find((filter, index) => {
            if (filter.column === options.filter.column) {
                if (objEquals(filter, newFilter)) {
                    isSame = true;
                    return true;
                }
                options.data.filters[index] = newFilter;
                hasMatch = true;
                return true;
            }
        });
        if (isSame || !hasMatch) {
            return;
        }
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
    let colData: IAVColumn
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
        case "mSelect":
            options.data.columns.find((column) => {
                if (column.id === options.filter.column) {
                    colData = column;
                    if (column.type === "select") {
                        selectHTML = `<option ${"=" === options.filter.operator ? "selected" : ""} value="=">${window.siyuan.languages.filterOperatorIs}</option>
<option ${"!=" === options.filter.operator ? "selected" : ""} value="!=">${window.siyuan.languages.filterOperatorIsNot}</option>
<option ${"Is empty" === options.filter.operator ? "selected" : ""} value="Is empty">${window.siyuan.languages.filterOperatorIsEmpty}</option>
<option ${"Is not empty" === options.filter.operator ? "selected" : ""} value="Is not empty">${window.siyuan.languages.filterOperatorIsNotEmpty}</option>
`;
                    } else {
                        selectHTML = `<option ${"Contains" === options.filter.operator ? "selected" : ""} value="Contains">${window.siyuan.languages.filterOperatorContains}</option>
<option ${"Does not contains" === options.filter.operator ? "selected" : ""} value="Does not contains">${window.siyuan.languages.filterOperatorDoesNotContain}</option>
<option ${"Is empty" === options.filter.operator ? "selected" : ""} value="Is empty">${window.siyuan.languages.filterOperatorIsEmpty}</option>
<option ${"Is not empty" === options.filter.operator ? "selected" : ""} value="Is not empty">${window.siyuan.languages.filterOperatorIsNotEmpty}</option>
`;
                    }
                    return true;
                }
            });
            break;
    }
    menu.addItem({
        iconHTML: "",
        label: `<select style="margin: 4px 0" class="b3-select fn__size200">${selectHTML}</select>`
    });
    if (colType === "mSelect") {
        // TODO
        colData.options.forEach((option) => {
            menu.addItem({
                label: `<input style="margin: 4px 0" value="${options.filter.value.text.content}" class="b3-text-field fn__size200">`,
                click() {

                }
            });
        });
    } else if (colType === "text") {
        menu.addItem({
            iconHTML: "",
            label: `<input style="margin: 4px 0" value="${options.filter.value.text.content}" class="b3-text-field fn__size200">`
        });
    } else if (colType === "number") {
        menu.addItem({
            iconHTML: "",
            label: `<input style="margin: 4px 0" value="${options.filter.value.number.isNotEmpty ? options.filter.value.number.content : ""}" class="b3-text-field fn__size200">`
        });
    }
    menu.addItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        click() {
            const oldFilters = Object.assign([], options.data.filters);
            options.data.filters.find((item: IAVFilter, index: number) => {
                if (item.column === options.filter.column) {
                    options.data.filters.splice(index, 1);
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
        }
    });
    const selectElement = (window.siyuan.menus.menu.element.querySelector(".b3-select") as HTMLSelectElement);
    selectElement.addEventListener("change", () => {
        if (selectElement.value === "Is empty" || selectElement.value === "Is not empty") {
            selectElement.parentElement.parentElement.nextElementSibling.classList.add("fn__none");
        } else {
            selectElement.parentElement.parentElement.nextElementSibling.classList.remove("fn__none");
        }
    });
    const textElement = window.siyuan.menus.menu.element.querySelector(".b3-text-field") as HTMLInputElement;
    if (textElement) {
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
    }
    if (selectElement.value === "Is empty" || selectElement.value === "Is not empty") {
        selectElement.parentElement.parentElement.nextElementSibling.classList.add("fn__none");
    } else {
        selectElement.parentElement.parentElement.nextElementSibling.classList.remove("fn__none");
    }
    menu.open({x: rectTarget.left, y: rectTarget.bottom});
    if (textElement) {
        textElement.select();
    }
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
                    const cellValue = getCellValue(column.type, "");
                    options.data.filters.push({
                        column: column.id,
                        operator: "Contains",
                        value: cellValue,
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
                    setFilter({
                        filter: {
                            operator: "Contains",
                            column: column.id,
                            value: cellValue
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
                let filterValue = ""
                if (filter.operator === "Is empty") {
                    filterValue = ": " + window.siyuan.languages.filterOperatorIsEmpty
                } else if (filter.operator === "Is not empty") {
                    filterValue = ": " + window.siyuan.languages.filterOperatorIsNotEmpty
                } else if (filter.value?.number?.content && ["=", "!=", ">", "<", ">=", "<="].includes(filter.operator)) {
                    filterValue = ` ${filter.operator} ${filter.value.number.content}`
                } else if (filter.value?.text?.content && ["=", "Contains"].includes(filter.operator)) {
                    filterValue = `: ${filter.value.text.content}`
                } else if (filter.value?.text?.content && ["!=", "Does not contains"].includes(filter.operator)) {
                    filterValue = `Not ${filter.value.text.content}`
                } else if (filter.value?.text?.content && "Starts with" === filter.operator) {
                    filterValue = `: ${window.siyuan.languages.filterOperatorStartsWith} ${filter.value.text.content}`
                } else if (filter.value?.text?.content && "Ends with" === filter.operator) {
                    filterValue = `: ${window.siyuan.languages.filterOperatorEndsWith} ${filter.value.text.content}`
                }
                filterHTML += `<span data-type="setFilter" class="b3-chip${filterValue ? " b3-chip--primary" : ""}">
    <svg><use xlink:href="#${getColIconByType(item.type)}"></use></svg>
    <span class="fn__ellipsis">${item.name}${filterValue}</span>
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
