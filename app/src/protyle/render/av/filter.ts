import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {hasClosestByClassName} from "../../util/hasClosest";
import {getColIconByType} from "./col";
import {setPosition} from "../../../util/setPosition";
import {objEquals} from "../../../util/functions";
import {genCellValue} from "./cell";
import * as dayjs from "dayjs";
import {unicode2Emoji} from "../../../emoji";
import {openMenuPanel} from "./openMenuPanel";
import {fetchSyncPost} from "../../../util/fetch";
import {showMessage} from "../../../dialog/message";

export const getDefaultOperatorByType = (type: TAVCol) => {
    if (["select", "number", "date", "created", "updated"].includes(type)) {
        return "=";
    }
    if (["checkbox"].includes(type)) {
        return "Is false";
    }
    if (["rollup", "relation", "rollup", "text", "mSelect", "url", "block", "email", "phone", "template"].includes(type)) {
        return "Contains";
    }
};

const toggleEmpty = (element: HTMLElement, operator: string, type: TAVCol) => {
    const menuElement = hasClosestByClassName(element, "b3-menu");
    if (menuElement) {
        if (["date", "updated", "created"].includes(type)) {
            const filterElement = menuElement.querySelector('.b3-menu__item div[data-type="filter1"]');
            const filter2Element = filterElement.nextElementSibling;
            if (operator === "Is between") {
                filter2Element.classList.remove("fn__none");
                filterElement.classList.remove("fn__none");
            } else if (operator === "Is empty" || operator === "Is not empty") {
                filter2Element.classList.add("fn__none");
                filterElement.classList.add("fn__none");
            } else {
                filterElement.classList.remove("fn__none");
                filter2Element.classList.add("fn__none");
            }
            return;
        }
        menuElement.querySelectorAll("input, .b3-chip").forEach((inputElement) => {
            const menuItemElement = hasClosestByClassName(inputElement, "b3-menu__item");
            if (menuItemElement) {
                if (operator !== "Is empty" && operator !== "Is not empty") {
                    menuItemElement.classList.remove("fn__none");
                } else {
                    menuItemElement.classList.add("fn__none");
                }
            }
        });
    }
};

export const setFilter = async (options: {
    filter: IAVFilter,
    protyle: IProtyle,
    data: IAV,
    target: HTMLElement,
    blockElement: Element
}) => {
    let rectTarget = options.target.getBoundingClientRect();
    if (rectTarget.height === 0) {
        rectTarget = options.protyle.wysiwyg.element.querySelector(`[data-col-id="${options.target.dataset.colId}"]`).getBoundingClientRect();
    }
    const blockID = options.blockElement.getAttribute("data-node-id");
    const menu = new Menu("set-filter-" + options.filter.column, () => {
        const oldFilters = JSON.parse(JSON.stringify(options.data.view.filters));
        const selectElement = menu.element.querySelector(".b3-select") as HTMLSelectElement;
        if (!selectElement || !selectElement.value) {
            return;
        }
        const newFilter: IAVFilter = {
            column: options.filter.column,
            value: {
                type: options.filter.value.type
            },
            operator: selectElement.value as TAVFilterOperator
        };
        let hasMatch = false;
        let newValue;
        if (textElements.length > 0) {
            if (["date", "updated", "created"].includes(filterValue.type)) {
                const typeElement = menu.element.querySelector('.b3-select[data-type="dateType"]') as HTMLSelectElement;
                const directElements = menu.element.querySelectorAll('.b3-select[data-type="dataDirection"]') as NodeListOf<HTMLSelectElement>;
                if (typeElement.value === "custom") {
                    newFilter.relativeDate = {
                        count: parseInt((directElements[0].parentElement.querySelector(".b3-text-field") as HTMLInputElement).value || "1"),
                        unit: parseInt((directElements[0].parentElement.lastElementChild as HTMLSelectElement).value),
                        direction: parseInt(directElements[0].value)
                    };
                    newFilter.relativeDate2 = {
                        count: parseInt((directElements[1].parentElement.querySelector(".b3-text-field") as HTMLInputElement).value || "1"),
                        unit: parseInt((directElements[1].parentElement.lastElementChild as HTMLSelectElement).value),
                        direction: parseInt(directElements[1].value)
                    };
                    newValue = {type: filterValue.type};
                } else {
                    newValue = genCellValue(filterValue.type, {
                        isNotEmpty2: textElements[2].value !== "",
                        isNotEmpty: textElements[0].value !== "",
                        content: textElements[0].value ? new Date(textElements[0].value + " 00:00").getTime() : null,
                        content2: textElements[2].value ? new Date(textElements[2].value + " 00:00").getTime() : null,
                        hasEndDate: newFilter.operator === "Is between",
                        isNotTime: true,
                    });
                    newFilter.relativeDate = null;
                    newFilter.relativeDate2 = null;
                }
            } else {
                newValue = genCellValue(filterValue.type, textElements[0].value);
            }
        } else if (filterValue.type === "select" || filterValue.type === "mSelect") {
            const mSelect: {
                color: string,
                content: string
            }[] = [];
            window.siyuan.menus.menu.element.querySelectorAll("svg").forEach(item => {
                if (item.firstElementChild.getAttribute("xlink:href") === "#iconCheck") {
                    const chipElement = item.nextElementSibling.firstElementChild as HTMLElement;
                    mSelect.push({
                        color: chipElement.dataset.color,
                        content: chipElement.dataset.name
                    });
                }
            });
            newValue = genCellValue(filterValue.type, mSelect);
        } else if (filterValue.type === "checkbox") {
            newValue = genCellValue(filterValue.type, {
                checked: newFilter.operator === "Is true"
            });
        } else {
            newValue = genCellValue(filterValue.type, undefined);
        }
        if (options.filter.value.type === "rollup") {
            newFilter.value = {
                rollup: {
                    contents: [newValue],
                },
                type: "rollup"
            };
        } else {
            newFilter.value = newValue;
        }
        let isSame = false;
        options.data.view.filters.find((filter, index) => {
            if (filter.column === options.filter.column && filter.value.type === options.filter.value.type) {
                if (filter.value.type === "checkbox") {
                    hasMatch = true;
                    options.data.view.filters[index] = newFilter;
                    return true;
                }
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
            data: options.data.view.filters,
            blockID
        }], [{
            action: "setAttrViewFilters",
            avID: options.data.id,
            data: oldFilters,
            blockID
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
    let filterValue = JSON.parse(JSON.stringify(options.filter.value));
    if (colData.type === "rollup") {
        if (!colData.rollup || !colData.rollup.relationKeyID || !colData.rollup.keyID) {
            showMessage(window.siyuan.languages.plsChoose);
            openMenuPanel({
                protyle: options.protyle,
                blockElement: options.blockElement,
                type: "edit",
                colId: colData.id
            });
            return;
        }
        let targetAVId = "";
        options.data.view.columns.find((column) => {
            if (column.id === colData.rollup.relationKeyID) {
                targetAVId = column.relation.avID;
                return true;
            }
        });
        const response = await fetchSyncPost("/api/av/getAttributeView", {id: targetAVId});
        response.data.av.keyValues.find((item: { key: { id: string, name: string, type: TAVCol } }) => {
            if (item.key.id === colData.rollup.keyID) {
                filterValue.type = item.key.type;
                return true;
            }
        });
        options.data.view.filters.find(item => {
            if (item.column === colData.id && item.value.type === "rollup") {
                if (!item.value.rollup || !item.value.rollup.contents || item.value.rollup.contents.length === 0) {
                    filterValue = {
                        [filterValue.type]: genCellValue(filterValue.type, filterValue.type === "checkbox" ? {checked: undefined} : ""),
                        type: filterValue.type
                    };
                } else {
                    filterValue = item.value.rollup.contents[0];
                }
                return true;
            }
        });
    }
    let checkboxInit = false;
    if (filterValue.type === "checkbox") {
        checkboxInit = typeof filterValue.checkbox === "undefined" || typeof filterValue.checkbox.checked === "undefined";
    }
    switch (filterValue.type) {
        case "checkbox":
            selectHTML = `<option ${("Is true" === options.filter.operator && !checkboxInit) ? "selected" : ""} value="Is true">${window.siyuan.languages.checked}</option>
<option ${("Is false" === options.filter.operator && !checkboxInit) ? "selected" : ""} value="Is false">${window.siyuan.languages.unchecked}</option>`;
            if (checkboxInit) {
                selectHTML = `<option selected></option>${selectHTML}`;
            }
            break;
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
        case "template":
            selectHTML = `<option ${"=" === options.filter.operator ? "selected" : ""} value="=">${window.siyuan.languages.filterOperatorIs}</option>
<option ${"!=" === options.filter.operator ? "selected" : ""} value="!=">${window.siyuan.languages.filterOperatorIsNot}</option>
<option ${"Contains" === options.filter.operator ? "selected" : ""} value="Contains">${window.siyuan.languages.filterOperatorContains}</option>
<option ${"Does not contains" === options.filter.operator ? "selected" : ""} value="Does not contains">${window.siyuan.languages.filterOperatorDoesNotContain}</option>
<option ${"Starts with" === options.filter.operator ? "selected" : ""} value="Starts with">${window.siyuan.languages.filterOperatorStartsWith}</option>
<option ${"Ends with" === options.filter.operator ? "selected" : ""} value="Ends with">${window.siyuan.languages.filterOperatorEndsWith}</option>
<option ${"Is empty" === options.filter.operator ? "selected" : ""} value="Is empty">${window.siyuan.languages.filterOperatorIsEmpty}</option>
<option ${"Is not empty" === options.filter.operator ? "selected" : ""} value="Is not empty">${window.siyuan.languages.filterOperatorIsNotEmpty}</option>
<option ${">" === options.filter.operator ? "selected" : ""} value=">">&gt;</option>
<option ${"<" === options.filter.operator ? "selected" : ""} value="<">&lt;</option>
<option ${">=" === options.filter.operator ? "selected" : ""} value=">=">&GreaterEqual;</option>
<option ${"<=" === options.filter.operator ? "selected" : ""} value="<=">&le;</option>`;
            break;
        case "date":
        case "created":
        case "updated":
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
        case "relation":
            selectHTML = `<option ${"Contains" === options.filter.operator ? "selected" : ""} value="Contains">${window.siyuan.languages.filterOperatorContains}</option>
<option ${"Does not contains" === options.filter.operator ? "selected" : ""} value="Does not contains">${window.siyuan.languages.filterOperatorDoesNotContain}</option>
<option ${"Is empty" === options.filter.operator ? "selected" : ""} value="Is empty">${window.siyuan.languages.filterOperatorIsEmpty}</option>
<option ${"Is not empty" === options.filter.operator ? "selected" : ""} value="Is not empty">${window.siyuan.languages.filterOperatorIsNotEmpty}</option>`;
            break;
        case "select":
            selectHTML = `<option ${"=" === options.filter.operator ? "selected" : ""} value="=">${window.siyuan.languages.filterOperatorIs}</option>
<option ${"!=" === options.filter.operator ? "selected" : ""} value="!=">${window.siyuan.languages.filterOperatorIsNot}</option>
<option ${"Is empty" === options.filter.operator ? "selected" : ""} value="Is empty">${window.siyuan.languages.filterOperatorIsEmpty}</option>
<option ${"Is not empty" === options.filter.operator ? "selected" : ""} value="Is not empty">${window.siyuan.languages.filterOperatorIsNotEmpty}</option>`;
            break;
    }
    menu.addItem({
        iconHTML: "",
        type: "readonly",
        label: `<select style="margin: 4px 0" class="b3-select fn__size200">${selectHTML}</select>`
    });
    if (filterValue.type === "select" || filterValue.type === "mSelect") {
        colData.options?.forEach((option) => {
            let icon = "iconUncheck";
            filterValue?.mSelect?.find((optionItem: IAVCellSelectValue) => {
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
    } else if (["text", "url", "block", "email", "phone", "template", "relation"].includes(filterValue.type)) {
        let value = "";
        if (filterValue) {
            if (filterValue.type === "relation") {
                value = filterValue.relation.blockIDs[0] || "";
            } else {
                value = filterValue[filterValue.type as "text"].content || "";
            }
        }
        menu.addItem({
            iconHTML: "",
            type: "readonly",
            label: `<input style="margin: 4px 0" value="${value}" class="b3-text-field fn__size200">`
        });
    } else if (filterValue.type === "number") {
        menu.addItem({
            iconHTML: "",
            type: "readonly",
            label: `<input style="margin: 4px 0" value="${filterValue?.number.isNotEmpty ? filterValue.number.content : ""}" class="b3-text-field fn__size200">`
        });
    } else if (["date", "updated", "created"].includes(filterValue.type)) {
        const dateValue = filterValue ? filterValue[filterValue.type as "date"] : null;
        const showToday = !options.filter.relativeDate?.direction;
        const showToday2 = !options.filter.relativeDate2?.direction;
        menu.addItem({
            iconHTML: "",
            type: "readonly",
            label: `<div data-type="filter1">
    <div class="fn__size200">
        <select class="b3-select fn__block" data-type="dateType">
            <option value="time"${!options.filter.relativeDate ? " selected" : ""}>${window.siyuan.languages.includeTime}</option>
            <option value="custom"${options.filter.relativeDate ? " selected" : ""}>${window.siyuan.languages.relativeToToday}</option>
        </select>
    </div>
    <div class="fn__hr"></div>
    <div class="fn__size200 ${options.filter.relativeDate ? "fn__none" : ""}">
        <input value="${(dateValue && (dateValue.isNotEmpty || filterValue.type !== "date")) ? dayjs(dateValue.content).format("YYYY-MM-DD") : ""}" type="date" max="9999-12-31" class="b3-text-field fn__block">
    </div>
    <div class="fn__flex fn__size200 ${options.filter.relativeDate ? "" : "fn__none"}">
        <select class="b3-select" data-type="dataDirection">
            <option value="-1"${options.filter.relativeDate?.direction === -1 ? " selected" : ""}>${window.siyuan.languages.pastDate}</option>
            <option value="1"${options.filter.relativeDate?.direction === 1 ? " selected" : ""}>${window.siyuan.languages.nextDate}</option>
            <option value="0"${showToday ? " selected" : ""}>${window.siyuan.languages.current}</option>
        </select>
        <span class="fn__space"></span>
        <input type="number" min="1" step="1" value="${options.filter.relativeDate?.count || 1}" class="b3-text-field fn__flex-1${showToday ? " fn__none" : ""}"/>
        <span class="fn__space${showToday ? " fn__none" : ""}"></span>
        <select class="b3-select fn__flex-1">
            <option value="0"${options.filter.relativeDate?.unit === 0 ? " selected" : ""}>${window.siyuan.languages.day}</option>
            <option value="1"${(!options.filter.relativeDate || options.filter.relativeDate?.unit === 1) ? " selected" : ""}>${window.siyuan.languages.week}</option>
            <option value="2"${options.filter.relativeDate?.unit === 2 ? " selected" : ""}>${window.siyuan.languages.month}</option>
            <option value="3"${options.filter.relativeDate?.unit === 3 ? " selected" : ""}>${window.siyuan.languages.year}</option>
        </select>
    </div>
    <div class="fn__hr--small"></div>
</div>
<div data-type="filter2 fn__none">
    <div class="fn__hr--small"></div>
    <div class="fn__size200 ${options.filter.relativeDate2 ? "fn__none" : ""}">
        <input value="${(dateValue && dateValue.isNotEmpty2) ? dayjs(dateValue.content2).format("YYYY-MM-DD") : ""}" type="date" max="9999-12-31" class="b3-text-field fn__block">
    </div>
    <div class="fn__flex fn__size200 ${options.filter.relativeDate2 ? "" : "fn__none"}">
        <select class="b3-select" data-type="dataDirection">
            <option value="-1"${options.filter.relativeDate2?.direction === -1 ? " selected" : ""}>${window.siyuan.languages.pastDate}</option>
            <option value="1"${options.filter.relativeDate2?.direction === 1 ? " selected" : ""}>${window.siyuan.languages.nextDate}</option>
            <option value="0"${showToday2 ? " selected" : ""}>${window.siyuan.languages.current}</option>
        </select>
        <span class="fn__space"></span>
        <input type="number" min="1" step="1" value="${options.filter.relativeDate2?.count || 1}" class="b3-text-field fn__flex-1${showToday2 ? " fn__none" : ""}"/>
        <span class="fn__space${showToday2 ? " fn__none" : ""}"></span>
        <select class="b3-select fn__flex-1">
            <option value="0"${options.filter.relativeDate2?.unit === 0 ? " selected" : ""}>${window.siyuan.languages.day}</option>
            <option value="1"${(!options.filter.relativeDate2 || options.filter.relativeDate2?.unit === 1) ? " selected" : ""}>${window.siyuan.languages.week}</option>
            <option value="2"${options.filter.relativeDate2?.unit === 2 ? " selected" : ""}>${window.siyuan.languages.month}</option>
            <option value="3"${options.filter.relativeDate2?.unit === 3 ? " selected" : ""}>${window.siyuan.languages.year}</option>
        </select>
    </div>
    <div class="fn__hr--small"></div>
</div>`
        });
    }
    menu.addItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.removeFilters,
        click() {
            const oldFilters = Object.assign([], options.data.view.filters);
            options.data.view.filters.find((item: IAVFilter, index: number) => {
                if (item.column === options.filter.column && options.filter.value.type === item.value.type) {
                    options.data.view.filters.splice(index, 1);
                    return true;
                }
            });
            transaction(options.protyle, [{
                action: "setAttrViewFilters",
                avID: options.data.id,
                data: options.data.view.filters,
                blockID
            }], [{
                action: "setAttrViewFilters",
                avID: options.data.id,
                data: oldFilters,
                blockID
            }]);
            const menuElement = hasClosestByClassName(options.target, "b3-menu");
            if (menuElement) {
                menuElement.innerHTML = getFiltersHTML(options.data.view);
            }
        }
    });
    const selectElement = (menu.element.querySelector(".b3-select") as HTMLSelectElement);
    selectElement.addEventListener("change", () => {
        toggleEmpty(selectElement, selectElement.value, filterValue.type);
    });
    const dateTypeElement = menu.element.querySelector('.b3-select[data-type="dateType"]') as HTMLSelectElement;
    dateTypeElement?.addEventListener("change", () => {
        const directionElements = menu.element.querySelectorAll('[data-type="dataDirection"]');
        const customerElement = directionElements[0].parentElement;
        const customer2Element = directionElements[1].parentElement;
        const timeElement = customerElement.previousElementSibling;
        const time2Element = customer2Element.previousElementSibling;
        if (dateTypeElement.value === "custom") {
            customerElement.classList.remove("fn__none");
            customer2Element.classList.remove("fn__none");
            timeElement.classList.add("fn__none");
            time2Element.classList.add("fn__none");
        } else {
            customerElement.classList.add("fn__none");
            customer2Element.classList.add("fn__none");
            timeElement.classList.remove("fn__none");
            time2Element.classList.remove("fn__none");
        }
    });
    menu.element.querySelectorAll('.b3-select[data-type="dataDirection"]').forEach((item: HTMLSelectElement) => {
        item.addEventListener("change", () => {
            const countElement = item.nextElementSibling.nextElementSibling;
            if (item.value === "0") {
                countElement.classList.add("fn__none");
                countElement.nextElementSibling.classList.add("fn__none");
            } else {
                countElement.classList.remove("fn__none");
                countElement.nextElementSibling.classList.remove("fn__none");
            }
        });
    });

    const textElements: NodeListOf<HTMLInputElement> = menu.element.querySelectorAll(".b3-text-field");
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
    toggleEmpty(selectElement, selectElement.value, filterValue.type);
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
    blockElement: Element
}) => {
    const menu = new Menu("av-add-filter");
    options.data.view.columns.forEach((column) => {
        let filter: IAVFilter;
        options.data.view.filters.find((item) => {
            if (item.column === column.id && item.value.type === column.type) {
                filter = item;
                return true;
            }
        });
        if (!filter && column.type !== "mAsset") {
            menu.addItem({
                label: column.name,
                iconHTML: column.icon ? unicode2Emoji(column.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(column.type)}"></use></svg>`,
                click: () => {
                    const cellValue = genCellValue(column.type, column.type === "checkbox" ? {checked: undefined} : "");
                    filter = {
                        column: column.id,
                        operator: getDefaultOperatorByType(column.type),
                        value: cellValue,
                    };
                    options.data.view.filters.push(filter);
                    options.menuElement.innerHTML = getFiltersHTML(options.data.view);
                    setPosition(options.menuElement, options.tabRect.right - options.menuElement.clientWidth, options.tabRect.bottom, options.tabRect.height);
                    const filterElement = options.menuElement.querySelector(`[data-id="${column.id}"] .b3-chip`) as HTMLElement;
                    setFilter({
                        filter,
                        protyle: options.protyle,
                        data: options.data,
                        target: filterElement,
                        blockElement: options.blockElement
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
            if (item.id === filter.column && item.type === filter.value.type) {
                let filterText = "";
                const filterValue = item.type === "rollup" ? (filter.value.rollup?.contents?.length > 0 ? filter.value.rollup.contents[0] : {type: "rollup"} as IAVCellValue) : filter.value;
                if (filter.operator === "Is empty") {
                    filterText = ": " + window.siyuan.languages.filterOperatorIsEmpty;
                } else if (filter.operator === "Is not empty") {
                    filterText = ": " + window.siyuan.languages.filterOperatorIsNotEmpty;
                } else if (filter.operator === "Is false") {
                    if (filterValue.type !== "checkbox" || typeof filterValue.checkbox.checked === "boolean") {
                        filterText = ": " + window.siyuan.languages.unchecked;
                    }
                } else if (filter.operator === "Is true") {
                    if (filterValue.type !== "checkbox" || typeof filterValue.checkbox.checked === "boolean") {
                        filterText = ": " + window.siyuan.languages.checked;
                    }
                } else if (["created", "updated", "date"].includes(filterValue.type)) {
                    let dateValue = "";
                    let dateValue2 = "";
                    if (filter.relativeDate) {
                        dateValue = `${window.siyuan.languages[["pastDate", "current", "nextDate"][filter.relativeDate.direction + 1]]}
 ${filter.relativeDate.direction ? filter.relativeDate.count : ""}
 ${window.siyuan.languages[["day", "week", "month", "year"][filter.relativeDate.unit]]}`;
                        if (filter.relativeDate2) {
                            dateValue2 = `${window.siyuan.languages[["pastDate", "current", "nextDate"][filter.relativeDate2.direction + 1]]}
 ${filter.relativeDate2.direction ? filter.relativeDate2.count : ""}
 ${window.siyuan.languages[["day", "week", "month", "year"][filter.relativeDate2.unit]]}`;
                        }
                    } else if (filterValue && filterValue[filterValue.type as "date"]?.content) {
                        dateValue = dayjs(filterValue[filterValue.type as "date"].content).format("YYYY-MM-DD");
                        dateValue2 = dayjs(filterValue[filterValue.type as "date"].content2).format("YYYY-MM-DD");
                    }
                    if (dateValue) {
                        if (filter.operator === "Is between") {
                            filterText = ` ${window.siyuan.languages.filterOperatorIsBetween} ${dateValue} ${dateValue2}`;
                        } else if ("=" === filter.operator) {
                            filterText = `: ${dateValue}`;
                        } else if ([">", "<"].includes(filter.operator)) {
                            filterText = ` ${filter.operator} ${dateValue}`;
                        } else if (">=" === filter.operator) {
                            filterText = ` ≥ ${dateValue}`;
                        } else if ("<=" === filter.operator) {
                            filterText = ` ≤ ${dateValue}`;
                        }
                    }
                } else if (["mSelect", "select"].includes(filterValue.type) && filterValue.mSelect?.length > 0) {
                    let selectContent = "";
                    filterValue.mSelect.forEach((item, index) => {
                        selectContent += item.content;
                        if (index !== filterValue.mSelect.length - 1) {
                            selectContent += ", ";
                        }
                    });
                    if ("Contains" === filter.operator) {
                        filterText = `: ${selectContent}`;
                    } else if (filter.operator === "Does not contains") {
                        filterText = ` ${window.siyuan.languages.filterOperatorDoesNotContain} ${selectContent}`;
                    } else if (filter.operator === "=") {
                        filterText = `: ${selectContent}`;
                    } else if (filter.operator === "!=") {
                        filterText = ` ${window.siyuan.languages.filterOperatorIsNot} ${selectContent}`;
                    }
                } else if (filterValue.type === "number" && filterValue.number && filterValue.number.isNotEmpty) {
                    if (["=", "!=", ">", "<"].includes(filter.operator)) {
                        filterText = ` ${filter.operator} ${filterValue.number.content}`;
                    } else if (">=" === filter.operator) {
                        filterText = ` ≥ ${filterValue.number.content}`;
                    } else if ("<=" === filter.operator) {
                        filterText = ` ≤ ${filterValue.number.content}`;
                    }
                } else if (["text", "block", "url", "phone", "email", "relation", "template"].includes(filterValue.type) && filterValue[filterValue.type as "text"]) {
                    const content = filterValue[filterValue.type as "text"].content ||
                        filterValue.relation?.blockIDs[0] || "";
                    if (["=", "Contains"].includes(filter.operator)) {
                        filterText = `: ${content}`;
                    } else if (filter.operator === "Does not contains") {
                        filterText = ` ${window.siyuan.languages.filterOperatorDoesNotContain} ${content}`;
                    } else if (filter.operator === "!=") {
                        filterText = ` ${window.siyuan.languages.filterOperatorIsNot} ${content}`;
                    } else if ("Starts with" === filter.operator) {
                        filterText = ` ${window.siyuan.languages.filterOperatorStartsWith} ${content}`;
                    } else if ("Ends with" === filter.operator) {
                        filterText = ` ${window.siyuan.languages.filterOperatorEndsWith} ${content}`;
                    } else if ([">", "<"].includes(filter.operator)) {
                        filterText = ` ${filter.operator} ${content}`;
                    } else if (">=" === filter.operator) {
                        filterText = ` ≥ ${content}`;
                    } else if ("<=" === filter.operator) {
                        filterText = ` ≤ ${content}`;
                    }
                }
                filterHTML += `<span data-type="setFilter" class="b3-chip${filterText ? " b3-chip--primary" : ""}">
    ${item.icon ? unicode2Emoji(item.icon, "icon", true) : `<svg class="icon"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>`}
    <span class="fn__ellipsis">${item.name}${filterText}</span>
</span>`;
                return true;
            }
        });
        return filterHTML;
    };

    data.filters.forEach((item: IAVFilter) => {
        const filterHTML = genFilterItem(item);
        if (filterHTML) {
            html += `<button class="b3-menu__item" draggable="true" data-id="${item.column}" data-filter-type="${item.value.type}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="fn__flex-1">${filterHTML}</div>
    <svg class="b3-menu__action" data-type="removeFilter"><use xlink:href="#iconTrashcan"></use></svg>
</button>`;
        }
    });
    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="go-config">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages.filter}</span>
</button>
<button class="b3-menu__separator"></button>
${html}
<button class="b3-menu__item${data.filters.length === data.columns.length ? " fn__none" : ""}" data-type="addFilter">
    <svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.addFilter}</span>
</button>
<button class="b3-menu__item${html ? "" : " fn__none"}" data-type="removeFilters">
    <svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.removeFilters}</span>
</button>
</div>`;
};
