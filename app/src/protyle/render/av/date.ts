import {transaction} from "../../wysiwyg/transaction";
import * as dayjs from "dayjs";
import {updateAttrViewCellAnimation} from "./action";
import {genAVValueHTML} from "./blockAttr";
import {hasClosestByClassName} from "../../util/hasClosest";
import {genCellValueByElement, getTypeByCellElement} from "./cell";

export const getDateHTML = (data: IAVTable, cellElements: HTMLElement[]) => {
    let hasEndDate = true;
    let cellValue: IAVCell;
    cellElements.forEach((cellElement) => {
        data.rows.find(row => {
            if ((hasClosestByClassName(cellElement, "av__row") as HTMLElement).dataset.id === row.id) {
                row.cells.find(cell => {
                    if (cell.id === cellElement.dataset.id) {
                        if (!cell.value || !cell.value.date || !cell.value.date.hasEndDate) {
                            hasEndDate = false;
                        }
                        cellValue = cell;
                        return true;
                    }
                });
                return true;
            }
        });
    });
    if (!cellValue) {
        hasEndDate = false;
    }
    const isNotTime = !cellValue || cellValue?.value?.date?.isNotTime;
    let value = "";
    if (cellValue?.value?.date?.isNotEmpty) {
        value = dayjs(cellValue.value.date.content).format(isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
    }
    let value2 = "";
    if (cellValue?.value?.date?.isNotEmpty2) {
        value2 = dayjs(cellValue.value.date.content2).format(isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
    }
    return `<div class="b3-menu__items">
<div>
    <input type="${isNotTime ? "date" : "datetime-local"}" max="${isNotTime ? "9999-12-31" : "9999-12-31 23:59"}" value="${value}" data-value="${value ? dayjs(cellValue.value.date.content).format("YYYY-MM-DD HH:mm") : ""}" class="b3-text-field fn__size200" style="margin-top: 4px;"><br>
    <input type="${isNotTime ? "date" : "datetime-local"}" max="${isNotTime ? "9999-12-31" : "9999-12-31 23:59"}" value="${value2}" data-value="${value2 ? dayjs(cellValue.value.date.content2).format("YYYY-MM-DD HH:mm") : ""}" style="margin-top: 8px;margin-bottom: 4px" class="b3-text-field fn__size200${hasEndDate ? "" : " fn__none"}">
    <button class="b3-menu__separator"></button>
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.endDate}</span>
        <span class="fn__space fn__flex-1"></span>
        <input type="checkbox" class="b3-switch b3-switch--menu"${hasEndDate ? " checked" : ""}>
    </label>
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.includeTime}</span>
        <span class="fn__space fn__flex-1"></span>
        <input type="checkbox" class="b3-switch b3-switch--menu"${isNotTime ? "" : " checked"}>
    </label>
    <button class="b3-menu__separator"></button>
    <button class="b3-menu__item" data-type="clearDate">
        <svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg>
        <span class="b3-menu__label">${window.siyuan.languages.clear}</span>
    </button>
</div>
</div>`;
};

export const bindDateEvent = (options: {
    protyle: IProtyle,
    data: IAV,
    menuElement: HTMLElement,
    blockElement: Element,
    cellElements: HTMLElement[]
}) => {
    const inputElements: NodeListOf<HTMLInputElement> = options.menuElement.querySelectorAll("input");
    inputElements[0].addEventListener("change", () => {
        inputElements[0].dataset.value = inputElements[0].value.length > 10 ? inputElements[0].value : inputElements[0].value + " 00:00";
        setDateValue({
            cellElements: options.cellElements,
            data: options.data,
            protyle: options.protyle,
            blockElement: options.blockElement,
            value: {
                isNotEmpty: inputElements[0].value !== "",
                content: new Date(inputElements[0].dataset.value).getTime(),
                isNotTime: !inputElements[3].checked
            }
        });
    });
    inputElements[1].addEventListener("change", () => {
        inputElements[1].dataset.value = inputElements[1].value.length > 10 ? inputElements[1].value : inputElements[1].value + " 00:00";
        setDateValue({
            cellElements: options.cellElements,
            data: options.data,
            protyle: options.protyle,
            blockElement: options.blockElement,
            value: {
                isNotEmpty2: inputElements[1].value !== "",
                content2: new Date(inputElements[1].dataset.value).getTime(),
                isNotTime: !inputElements[3].checked
            }
        });
    });
    inputElements[2].addEventListener("change", () => {
        if (inputElements[2].checked) {
            inputElements[1].classList.remove("fn__none");
        } else {
            inputElements[1].classList.add("fn__none");
        }
        setDateValue({
            cellElements: options.cellElements,
            data: options.data,
            blockElement: options.blockElement,
            protyle: options.protyle,
            value: {
                hasEndDate: inputElements[2].checked,
                isNotTime: !inputElements[3].checked
            }
        });
    });
    inputElements[3].addEventListener("change", () => {
        if (inputElements[3].checked) {
            inputElements[0].setAttribute("type", "datetime-local");
            inputElements[1].setAttribute("type", "datetime-local");
            inputElements[0].setAttribute("max", "9999-12-31 23:59");
            inputElements[1].setAttribute("max", "9999-12-31 23:59");
            inputElements[0].value = inputElements[0].dataset.value;
            inputElements[1].value = inputElements[1].dataset.value;
        } else {
            inputElements[0].setAttribute("type", "date");
            inputElements[1].setAttribute("type", "date");
            inputElements[0].setAttribute("max", "9999-12-31");
            inputElements[1].setAttribute("max", "9999-12-31");
            inputElements[0].value = inputElements[0].dataset.value.substring(0, 10);
            inputElements[1].value = inputElements[1].dataset.value.substring(0, 10);
        }
        setDateValue({
            cellElements: options.cellElements,
            data: options.data,
            blockElement: options.blockElement,
            protyle: options.protyle,
            value: {
                isNotTime: !inputElements[3].checked
            }
        });
    });
};

export const setDateValue = (options: {
    cellElements: HTMLElement[],
    data: IAV
    protyle: IProtyle,
    value: IAVCellDateValue,
    blockElement: Element
}) => {
    const colId = options.cellElements[0].dataset.colId;
    const cellDoOperations: IOperation[] = [];
    const cellUndoOperations: IOperation[] = [];
    options.cellElements.forEach((item, elementIndex) => {
        if (!options.blockElement.contains(item)) {
            item = options.cellElements[elementIndex] = options.blockElement.querySelector(`.av__cell[data-id="${item.dataset.id}"]`) as HTMLElement;
        }
        const cellValue = genCellValueByElement(getTypeByCellElement(item) || item.dataset.type as TAVCol, item);
        const oldValue = JSON.parse(JSON.stringify(cellValue))
        const rowID = (hasClosestByClassName(item, "av__row") as HTMLElement).dataset.id;
        cellValue.date = Object.assign(cellValue.date || {
            isNotEmpty2: false,
            isNotEmpty: false
        }, options.value);
        cellDoOperations.push({
            action: "updateAttrViewCell",
            id: cellValue.id,
            keyID: colId,
            rowID,
            avID: options.data.id,
            data: cellValue
        });
        cellUndoOperations.push({
            action: "updateAttrViewCell",
            id: cellValue.id,
            keyID: colId,
            rowID,
            avID: options.data.id,
            data: oldValue
        });
        options.data.view.rows.find(row => {
            if (row.id === rowID) {
                row.cells.find(cell => {
                    if (cell.id === cellValue.id) {
                        cell.value = cellValue;
                        return true;
                    }
                });
                return true;
            }
        });
        if (item.classList.contains("custom-attr__avvalue")) {
            item.innerHTML = genAVValueHTML(cellValue);
        } else {
            updateAttrViewCellAnimation(item, cellValue);
        }
    });
    transaction(options.protyle, cellDoOperations, cellUndoOperations);
};
