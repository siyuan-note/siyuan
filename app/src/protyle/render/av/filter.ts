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
        const newFilter: IAVFilter = {
            column: options.filter.column,
            value: undefined,
            operator: selectElement.value as TAVFilterOperator
        };
        if (!selectElement || !newFilter.operator) {
            return;
        }
        let hasMatch = false;
        if (textElements.length > 0) {
            if (["date", "updated", "created"].includes(filterType)) {
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
                } else {
                    newFilter.value = genCellValue(filterType, {
                        isNotEmpty2: textElements[1].value !== "",
                        isNotEmpty: textElements[0].value !== "",
                        content: textElements[0].value ? new Date(textElements[0].value + " 00:00").getTime() : null,
                        content2: textElements[1].value ? new Date(textElements[1].value + " 00:00").getTime() : null,
                        hasEndDate: newFilter.operator === "Is between",
                        isNotTime: true,
                    });
                }
            } else {
                newFilter.value = genCellValue(filterType, textElements[0].value);
            }
        } else if (filterType === "select" || filterType === "mSelect") {
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
            newFilter.value = genCellValue(filterType, mSelect);
        } else if (filterType === "checkbox") {
            newFilter.value = genCellValue(filterType, {
                checked: newFilter.operator === "Is true"
            });
        } else {
            newFilter.value = genCellValue(filterType, undefined);
        }

        let isSame = false;
        options.data.view.filters.find((filter, index) => {
            if (filter.column === options.filter.column) {
                if (filter.type && filter.type === "checkbox") {
                    hasMatch = true;
                    delete filter.type;
                    options.data.view.filters[index] = newFilter;
                    return true;
                }
                delete filter.type;
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
    let filterType = colData.type;
    if (filterType === "rollup") {
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
                filterType = item.key.type;
                return true;
            }
        });
        options.data.view.filters.find(item => {
            if (item.column === colData.id && item.type) {
                item.operator = getDefaultOperatorByType(filterType);
                item.value = genCellValue(filterType, "");
                delete item.type;
                return true;
            }
        });
    }
    switch (filterType) {
        case "checkbox":
            selectHTML = `<option ${("Is true" === options.filter.operator && !options.filter.type) ? "selected" : ""} value="Is true">${window.siyuan.languages.checked}</option>
<option ${("Is false" === options.filter.operator && !options.filter.type) ? "selected" : ""} value="Is false">${window.siyuan.languages.unchecked}</option>`;
            if (options.filter.type) {
                // 初始化时有 type 字段
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
    if (filterType === "select" || filterType === "mSelect") {
        colData.options?.forEach((option) => {
            let icon = "iconUncheck";
            options.filter.value?.mSelect?.find((optionItem) => {
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
    } else if (["text", "url", "block", "email", "phone", "template", "relation"].includes(filterType)) {
        let value = "";
        if (options.filter.value) {
            if (filterType === "relation") {
                value = options.filter.value.relation.contents[0] || "";
            } else {
                value = options.filter.value[filterType as "text"].content || "";
            }
        }
        menu.addItem({
            iconHTML: "",
            type: "readonly",
            label: `<input style="margin: 4px 0" value="${value}" class="b3-text-field fn__size200">`
        });
    } else if (filterType === "number") {
        menu.addItem({
            iconHTML: "",
            type: "readonly",
            label: `<input style="margin: 4px 0" value="${options.filter.value?.number.isNotEmpty ? options.filter.value.number.content : ""}" class="b3-text-field fn__size200">`
        });
    } else if (["date", "updated", "created"].includes(filterType)) {
        const dateValue = options.filter.value ? options.filter.value[filterType as "date"] : null;
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
        <input value="${(dateValue && (dateValue.isNotEmpty || filterType !== "date")) ? dayjs(dateValue.content).format("YYYY-MM-DD") : ""}" type="date" max="9999-12-31" class="b3-text-field fn__block">
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
                if (item.column === options.filter.column) {
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
        toggleEmpty(selectElement, selectElement.value, filterType);
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
    toggleEmpty(selectElement, selectElement.value, filterType);
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
            if (item.column === column.id) {
                filter = item;
                return true;
            }
        });
        if (!filter && column.type !== "mAsset") {
            menu.addItem({
                label: column.name,
                iconHTML: column.icon ? unicode2Emoji(column.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(column.type)}"></use></svg>`,
                click: () => {
                    const cellValue = genCellValue(column.type, "");
                    filter = {
                        column: column.id,
                        operator: getDefaultOperatorByType(column.type),
                        value: cellValue,
                        type: column.type
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
            if (item.id === filter.column) {
                let filterValue = "";
                if (filter.operator === "Is empty") {
                    filterValue = ": " + window.siyuan.languages.filterOperatorIsEmpty;
                } else if (filter.operator === "Is not empty") {
                    filterValue = ": " + window.siyuan.languages.filterOperatorIsNotEmpty;
                } else if (filter.operator === "Is false") {
                    filterValue = ": " + window.siyuan.languages.unchecked;
                } else if (filter.operator === "Is true") {
                    filterValue = ": " + window.siyuan.languages.checked;
                } else if (filter.value?.date?.content || filter.relativeDate || filter.relativeDate2) {
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
                    } else if (filter.value?.date?.content) {
                        dateValue = dayjs(filter.value.date.content).format("YYYY-MM-DD");
                        dateValue2 = dayjs(filter.value.date.content2).format("YYYY-MM-DD");
                    }

                    if (filter.operator === "Is between") {
                        filterValue = ` ${window.siyuan.languages.filterOperatorIsBetween} ${dateValue} ${dateValue2}`;
                    } else if ("=" === filter.operator) {
                        filterValue = `: ${dateValue}`;
                    } else if ([">", "<"].includes(filter.operator)) {
                        filterValue = ` ${filter.operator} ${dateValue}`;
                    } else if (">=" === filter.operator) {
                        filterValue = ` ≥ ${dateValue}`;
                    } else if ("<=" === filter.operator) {
                        filterValue = ` ≤ ${dateValue}`;
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
                    filter.value?.phone?.content || filter.value?.email?.content || filter.value?.relation?.contents.length > 0) {
                    const content = filter.value?.text?.content || filter.value?.block?.content ||
                        filter.value?.url?.content || filter.value?.phone?.content || filter.value?.email?.content ||
                        filter.value?.relation?.contents[0];
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
    ${item.icon ? unicode2Emoji(item.icon, "icon", true) : `<svg class="icon"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>`}
    <span class="fn__ellipsis">${item.name}${filterValue}</span>
</span>`;
                return true;
            }
        });
        return filterHTML;
    };

    data.filters.forEach((item: IAVFilter) => {
        html += `<button class="b3-menu__item" draggable="true" data-id="${item.column}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="fn__flex-1">${genFilterItem(item)}</div>
    <svg class="b3-menu__action" data-type="removeFilter"><use xlink:href="#iconTrashcan"></use></svg>
</button>`;
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
