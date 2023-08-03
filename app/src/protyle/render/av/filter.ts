import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {hasClosestByClassName} from "../../util/hasClosest";
import {getColIconByType} from "./col";
import {setPosition} from "../../../util/setPosition";
import {objEquals} from "../../../util/functions";
import {genCellValue} from "./cell";
import * as dayjs from "dayjs";

export const getDefaultOperatorByType = (type: TAVCol) => {
    if (type === "number" || type === "select") {
        return "=";
    }
    if (["text", "mSelect", "url", "block", "email", "phone"].includes(type)) {
        return "Contains";
    }
};

const toggleEmpty = (element: HTMLElement, operator: string, type: TAVCol) => {
    const menuElement = hasClosestByClassName(element, "b3-menu");
    if (menuElement) {
        menuElement.querySelectorAll("input, .b3-chip").forEach((inputElement, index) => {
            const menuItemElement = hasClosestByClassName(inputElement, "b3-menu__item");
            if (menuItemElement) {
                if (type === "date") {
                    if (operator === "Is between") {
                        menuItemElement.classList.remove("fn__none");
                    } else if (operator === "Is empty" || operator === "Is not empty") {
                        menuItemElement.classList.add("fn__none");
                    } else {
                        if (index === 0) {
                            menuItemElement.classList.remove("fn__none");
                        } else {
                            menuItemElement.classList.add("fn__none");
                        }
                    }
                } else {
                    if (operator !== "Is empty" && operator !== "Is not empty") {
                        menuItemElement.classList.remove("fn__none");
                    } else {
                        menuItemElement.classList.add("fn__none");
                    }
                }
            }
        });
    }
};

export const setFilter = (options: {
    filter: IAVFilter,
    protyle: IProtyle,
    data: IAV,
    target: HTMLElement,
}) => {
    let rectTarget = options.target.getBoundingClientRect();
    if (rectTarget.height === 0) {
        rectTarget = options.protyle.wysiwyg.element.querySelector(`[data-col-id="${options.target.dataset.colId}"]`).getBoundingClientRect();
    }
    const menu = new Menu("set-filter-" + options.filter.column, () => {
        const oldFilters = JSON.parse(JSON.stringify(options.data.view.filters));
        const operator = (window.siyuan.menus.menu.element.querySelector(".b3-select") as HTMLSelectElement).value as TAVFilterOperator;
        let hasMatch = false;
        let cellValue: IAVCellValue;
        if (textElements.length > 0) {
            if (colData.type === "date") {
                cellValue = genCellValue(colData.type, {
                    isNotEmpty2: textElements[1].value !== "",
                    isNotEmpty: textElements[0].value !== "",
                    content: new Date(textElements[0].value).getTime(),
                    content2: new Date(textElements[1].value).getTime(),
                    hasEndDate: operator === "Is between"
                });
            } else {
                cellValue = genCellValue(colData.type, textElements[0].value);
            }
        } else {
            const mSelect: { color: string, content: string }[] = [];
            window.siyuan.menus.menu.element.querySelectorAll("svg").forEach(item => {
                if (item.firstElementChild.getAttribute("xlink:href") === "#iconCheck") {
                    const chipElement = item.nextElementSibling.firstElementChild as HTMLElement;
                    mSelect.push({
                        color: chipElement.dataset.color,
                        content: chipElement.dataset.name
                    });
                }
            });
            if (mSelect.length === 0) {
                mSelect.push({color: "", content: ""});
            }
            cellValue = genCellValue(colData.type, mSelect);
        }
        const newFilter: IAVFilter = {
            column: options.filter.column,
            value: cellValue,
            operator
        };

        let isSame = false;
        options.data.view.filters.find((filter, index) => {
            if (filter.column === options.filter.column) {
                if (objEquals(filter, newFilter)) {
                    isSame = true;
                    return true;
                }
                options.data.view.filters[index] = newFilter;
                hasMatch = true;
                return true;
            }
        });
        if (isSame || !hasMatch) {
            return;
        }
        transaction(options.protyle, [{
            action: "setAttrViewFilters",
            avID: options.data.id,
            data: options.data.view.filters
        }], [{
            action: "setAttrViewFilters",
            avID: options.data.id,
            data: oldFilters
        }]);
        const menuElement = hasClosestByClassName(options.target, "b3-menu");
        if (menuElement) {
            menuElement.innerHTML = getFiltersHTML(options.data.view);
        }
    });
    if (menu.isOpen) {
        return;
    }
    let selectHTML = "";
    let colData: IAVColumn;
    options.data.view.columns.find((column) => {
        if (column.id === options.filter.column) {
            colData = column;
            return true;
        }
    });
    switch (colData.type) {
        case "block":
        case "text":
        case "url":
        case "phone":
        case "email":
            selectHTML = `<option ${"=" === options.filter.operator ? "selected" : ""} value="=">${window.siyuan.languages.filterOperatorIs}</option>
<option ${"!=" === options.filter.operator ? "selected" : ""} value="!=">${window.siyuan.languages.filterOperatorIsNot}</option>
<option ${"Contains" === options.filter.operator ? "selected" : ""} value="Contains">${window.siyuan.languages.filterOperatorContains}</option>
<option ${"Does not contains" === options.filter.operator ? "selected" : ""} value="Does not contains">${window.siyuan.languages.filterOperatorDoesNotContain}</option>
<option ${"Starts with" === options.filter.operator ? "selected" : ""} value="Starts with">${window.siyuan.languages.filterOperatorStartsWith}</option>
<option ${"Ends with" === options.filter.operator ? "selected" : ""} value="Ends with">${window.siyuan.languages.filterOperatorEndsWith}</option>
<option ${"Is empty" === options.filter.operator ? "selected" : ""} value="Is empty">${window.siyuan.languages.filterOperatorIsEmpty}</option>
<option ${"Is not empty" === options.filter.operator ? "selected" : ""} value="Is not empty">${window.siyuan.languages.filterOperatorIsNotEmpty}</option>`;
            break;
        case "date":
            selectHTML = `<option ${"=" === options.filter.operator ? "selected" : ""} value="=">${window.siyuan.languages.filterOperatorIs}</option>
<option ${">" === options.filter.operator ? "selected" : ""} value=">">${window.siyuan.languages.filterOperatorIsAfter}</option>
<option ${"<" === options.filter.operator ? "selected" : ""} value="<">${window.siyuan.languages.filterOperatorIsBefore}</option>
<option ${">=" === options.filter.operator ? "selected" : ""} value=">=">${window.siyuan.languages.filterOperatorIsOnOrAfter}</option>
<option ${"<=" === options.filter.operator ? "selected" : ""} value="<=">${window.siyuan.languages.filterOperatorIsOnOrBefore}</option>
<option ${"Is between" === options.filter.operator ? "selected" : ""} value="Is between">${window.siyuan.languages.filterOperatorIsBetween}</option>
<option ${"Is empty" === options.filter.operator ? "selected" : ""} value="Is empty">${window.siyuan.languages.filterOperatorIsEmpty}</option>
<option ${"Is not empty" === options.filter.operator ? "selected" : ""} value="Is not empty">${window.siyuan.languages.filterOperatorIsNotEmpty}</option>`;
            break;
        case "number":
            selectHTML = `<option ${"=" === options.filter.operator ? "selected" : ""} value="=">=</option>
<option ${"!=" === options.filter.operator ? "selected" : ""} value="!=">!=</option>
<option ${">" === options.filter.operator ? "selected" : ""} value=">">&gt;</option>
<option ${"<" === options.filter.operator ? "selected" : ""} value="<">&lt;</option>
<option ${">=" === options.filter.operator ? "selected" : ""} value=">=">&GreaterEqual;</option>
<option ${"<=" === options.filter.operator ? "selected" : ""} value="<=">&le;</option>
<option ${"Is empty" === options.filter.operator ? "selected" : ""} value="Is empty">${window.siyuan.languages.filterOperatorIsEmpty}</option>
<option ${"Is not empty" === options.filter.operator ? "selected" : ""} value="Is not empty">${window.siyuan.languages.filterOperatorIsNotEmpty}</option>`;
            break;
        case "mSelect":
        case "select":
            if (colData.type === "select") {
                selectHTML = `<option ${"=" === options.filter.operator ? "selected" : ""} value="=">${window.siyuan.languages.filterOperatorIs}</option>
<option ${"!=" === options.filter.operator ? "selected" : ""} value="!=">${window.siyuan.languages.filterOperatorIsNot}</option>
<option ${"Is empty" === options.filter.operator ? "selected" : ""} value="Is empty">${window.siyuan.languages.filterOperatorIsEmpty}</option>
<option ${"Is not empty" === options.filter.operator ? "selected" : ""} value="Is not empty">${window.siyuan.languages.filterOperatorIsNotEmpty}</option>`;
            } else {
                selectHTML = `<option ${"Contains" === options.filter.operator ? "selected" : ""} value="Contains">${window.siyuan.languages.filterOperatorContains}</option>
<option ${"Does not contains" === options.filter.operator ? "selected" : ""} value="Does not contains">${window.siyuan.languages.filterOperatorDoesNotContain}</option>
<option ${"Is empty" === options.filter.operator ? "selected" : ""} value="Is empty">${window.siyuan.languages.filterOperatorIsEmpty}</option>
<option ${"Is not empty" === options.filter.operator ? "selected" : ""} value="Is not empty">${window.siyuan.languages.filterOperatorIsNotEmpty}</option>`;
            }
            break;
    }
    menu.addItem({
        iconHTML: "",
        label: `<select style="margin: 4px 0" class="b3-select fn__size200">${selectHTML}</select>`
    });
    if (colData.type === "select" || colData.type === "mSelect") {
        colData.options?.forEach((option) => {
            let icon = "iconUncheck";
            options.filter.value?.mSelect.find((optionItem) => {
                if (optionItem.content === option.name) {
                    icon = "iconCheck";
                }
            });
            menu.addItem({
                icon,
                label: `<span class="b3-chip b3-chip--middle" data-name="${option.name}" data-color="${option.color}" style="margin:3px 0;background-color:var(--b3-font-background${option.color});color:var(--b3-font-color${option.color})">
    <span class="fn__ellipsis">${option.name}</span>
</span>`,
                bind(element) {
                    element.addEventListener("click", () => {
                        const useElement = element.querySelector("use");
                        if (useElement.getAttribute("xlink:href") === "#iconUncheck") {
                            useElement.setAttribute("xlink:href", "#iconCheck");
                        } else {
                            useElement.setAttribute("xlink:href", "#iconUncheck");
                        }
                    });
                }
            });
        });
    } else if (["text", "url", "block", "email", "phone"].includes(colData.type)) {
        menu.addItem({
            iconHTML: "",
            label: `<input style="margin: 4px 0" value="${options.filter.value ? options.filter.value[colData.type as "text"].content : ""}" class="b3-text-field fn__size200">`
        });
    } else if (colData.type === "number") {
        menu.addItem({
            iconHTML: "",
            label: `<input style="margin: 4px 0" value="${options.filter.value?.number.isNotEmpty ? options.filter.value.number.content : ""}" class="b3-text-field fn__size200">`
        });
    } else if (colData.type === "date") {
        menu.addItem({
            iconHTML: "",
            label: `<input style="margin: 4px 0" value="${options.filter.value?.date.isNotEmpty ? dayjs(options.filter.value.date.content).format("YYYY-MM-DDTHH:mm") : ""}" type="datetime-local" class="b3-text-field fn__size200">`
        });
        menu.addItem({
            iconHTML: "",
            label: `<input style="margin: 4px 0" value="${options.filter.value?.date.isNotEmpty2 ? dayjs(options.filter.value.date.content2).format("YYYY-MM-DDTHH:mm") : ""}" type="datetime-local" class="b3-text-field fn__size200">`
        });
    }
    menu.addItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        click() {
            const oldFilters = Object.assign([], options.data.view.filters);
            options.data.view.filters.find((item: IAVFilter, index: number) => {
                if (item.column === options.filter.column) {
                    options.data.view.filters.splice(index, 1);
                    return true;
                }
            });
            transaction(options.protyle, [{
                action: "setAttrViewFilters",
                avID: options.data.id,
                data: options.data.view.filters
            }], [{
                action: "setAttrViewFilters",
                avID: options.data.id,
                data: oldFilters
            }]);
            const menuElement = hasClosestByClassName(options.target, "b3-menu");
            if (menuElement) {
                menuElement.innerHTML = getFiltersHTML(options.data.view);
            }
        }
    });
    const selectElement = (window.siyuan.menus.menu.element.querySelector(".b3-select") as HTMLSelectElement);
    selectElement.addEventListener("change", () => {
        toggleEmpty(selectElement, selectElement.value, colData.type);
    });
    const textElements: NodeListOf<HTMLInputElement> = window.siyuan.menus.menu.element.querySelectorAll(".b3-text-field");
    textElements.forEach(item => {
        item.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.isComposing) {
                event.preventDefault();
                return;
            }
            if (event.key === "Enter") {
                menu.close();
                event.preventDefault();
            }
        });
    });
    toggleEmpty(selectElement, selectElement.value, colData.type);
    menu.open({x: rectTarget.left, y: rectTarget.bottom});
    if (textElements.length > 0) {
        textElements[0].select();
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
    options.data.view.columns.forEach((column) => {
        let hasFilter = false;
        options.data.view.filters.find((filter) => {
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
                    const oldFilters = Object.assign([], options.data.view.filters);
                    const cellValue = genCellValue(column.type, "");
                    options.data.view.filters.push({
                        column: column.id,
                        operator: getDefaultOperatorByType(column.type),
                        value: cellValue,
                    });
                    transaction(options.protyle, [{
                        action: "setAttrViewFilters",
                        avID: options.data.id,
                        data: options.data.view.filters
                    }], [{
                        action: "setAttrViewFilters",
                        avID: options.data.id,
                        data: oldFilters
                    }]);
                    options.menuElement.innerHTML = getFiltersHTML(options.data.view);
                    setPosition(options.menuElement, options.tabRect.right - options.menuElement.clientWidth, options.tabRect.bottom, options.tabRect.height);
                    const filterElement = options.menuElement.querySelector(`[data-id="${column.id}"] .b3-chip`) as HTMLElement;
                    setFilter({
                        filter: {
                            operator: getDefaultOperatorByType(column.type),
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

export const getFiltersHTML = (data: IAVTable) => {
    let html = "";
    const genFilterItem = (filter: IAVFilter) => {
        let filterHTML = "";
        data.columns.find((item) => {
            if (item.id === filter.column) {
                let filterValue = "";
                if (filter.operator === "Is empty") {
                    filterValue = ": " + window.siyuan.languages.filterOperatorIsEmpty;
                } else if (filter.operator === "Is not empty") {
                    filterValue = ": " + window.siyuan.languages.filterOperatorIsNotEmpty;
                } else if (filter.value?.date?.content) {
                    if (filter.value?.date?.content2 && filter.operator === "Is between") {
                        filterValue = ` ${window.siyuan.languages.filterOperatorIsBetween} ${dayjs(filter.value.date.content).format("YYYY-MM-DD HH:mm")} ${dayjs(filter.value.date.content2).format("YYYY-MM-DD HH:mm")}`;
                    } else if ("=" === filter.operator) {
                        filterValue = `: ${dayjs(filter.value.date.content).format("YYYY-MM-DD HH:mm")}`;
                    } else if ([">", "<"].includes(filter.operator)) {
                        filterValue = ` ${filter.operator} ${dayjs(filter.value.date.content).format("YYYY-MM-DD HH:mm")}`;
                    } else if (">=" === filter.operator) {
                        filterValue = ` ≥ ${dayjs(filter.value.date.content).format("YYYY-MM-DD HH:mm")}`;
                    } else if ("<=" === filter.operator) {
                        filterValue = ` ≤ ${dayjs(filter.value.date.content).format("YYYY-MM-DD HH:mm")}`;
                    }
                } else if (filter.value?.mSelect?.length > 0) {
                    let selectContent = "";
                    filter.value.mSelect.forEach((item, index) => {
                        selectContent += item.content;
                        if (index !== filter.value.mSelect.length - 1) {
                            selectContent += ", ";
                        }
                    });
                    if ("Contains" === filter.operator) {
                        filterValue = `: ${selectContent}`;
                    } else if (filter.operator === "Does not contains") {
                        filterValue = ` ${window.siyuan.languages.filterOperatorDoesNotContain} ${selectContent}`;
                    }
                } else if (filter.value?.number?.content) {
                    if (["=", "!=", ">", "<"].includes(filter.operator)) {
                        filterValue = ` ${filter.operator} ${filter.value.number.content}`;
                    } else if (">=" === filter.operator) {
                        filterValue = ` ≥ ${filter.value.number.content}`;
                    } else if ("<=" === filter.operator) {
                        filterValue = ` ≤ ${filter.value.number.content}`;
                    }
                } else if (filter.value?.text?.content || filter.value?.block?.content || filter.value?.url?.content ||
                    filter.value?.phone?.content || filter.value?.email?.content) {
                    const content = filter.value?.text?.content || filter.value?.block?.content ||
                        filter.value?.url?.content || filter.value?.phone?.content || filter.value?.email?.content;
                    if (["=", "Contains"].includes(filter.operator)) {
                        filterValue = `: ${content}`;
                    } else if (filter.operator === "Does not contains") {
                        filterValue = ` ${window.siyuan.languages.filterOperatorDoesNotContain} ${content}`;
                    } else if (filter.operator === "!=") {
                        filterValue = ` ${window.siyuan.languages.filterOperatorIsNot} ${content}`;
                    } else if ("Starts with" === filter.operator) {
                        filterValue = ` ${window.siyuan.languages.filterOperatorStartsWith} ${content}`;
                    } else if ("Ends with" === filter.operator) {
                        filterValue = ` ${window.siyuan.languages.filterOperatorEndsWith} ${content}`;
                    }
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
    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
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
</button>
</div>`;
};
