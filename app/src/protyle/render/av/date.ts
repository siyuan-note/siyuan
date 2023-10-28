import {transaction} from "../../wysiwyg/transaction";
import * as dayjs from "dayjs";
import {updateAttrViewCellAnimation} from "./action";
import {genAVValueHTML} from "./blockAttr";

export const getDateHTML = (data: IAVTable, cellElements: HTMLElement[]) => {
    let hasEndDate = true;
    let cellValue: IAVCell;
    cellElements.forEach((cellElement) => {
        data.rows.find(row => {
            if (cellElement.parentElement.dataset.id === row.id) {
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
    let value = "";
    if (cellValue?.value?.date?.isNotEmpty) {
        value = dayjs(cellValue.value.date.content).format(cellValue.value.date.isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
    }
    let value2 = "";
    if (cellValue?.value?.date?.isNotEmpty2) {
        value2 = dayjs(cellValue.value.date.content2).format(cellValue.value.date.isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
    }
    return `<div class="b3-menu__items">
<div>
    <input type="${(!cellValue || cellValue?.value?.date?.isNotTime) ? "date" : "datetime-local"}" value="${value}" data-value="${value ? dayjs(cellValue.value.date.content).format("YYYY-MM-DD HH:mm") : ""}" class="b3-text-field fn__size200"><br>
    <input type="${(!cellValue || cellValue?.value?.date?.isNotTime) ? "date" : "datetime-local"}" value="${value2}" data-value="${value2 ? dayjs(cellValue.value.date.content2).format("YYYY-MM-DD HH:mm") : ""}" style="margin-top: 8px" class="b3-text-field fn__size200${hasEndDate ? "" : " fn__none"}">
    <button class="b3-menu__separator"></button>
    <label class="b3-menu__item">
        <span>${window.siyuan.languages.endDate}</span>
        <span class="fn__space fn__flex-1"></span>
        <input type="checkbox" class="b3-switch fn__flex-center"${hasEndDate ? " checked" : ""}>
    </label>
    <label class="b3-menu__item">
        <span>${window.siyuan.languages.includeTime}</span>
        <span class="fn__space fn__flex-1"></span>
        <input type="checkbox" class="b3-switch fn__flex-center"${(!cellValue || cellValue?.value?.date?.isNotTime) ? "" : " checked"}>
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
    cellElements: HTMLElement[]
}) => {
    const inputElements: NodeListOf<HTMLInputElement> = options.menuElement.querySelectorAll("input");
    inputElements[0].addEventListener("change", () => {
        inputElements[0].dataset.value = inputElements[0].value.length > 10 ? inputElements[0].value : inputElements[0].value + " 00:00";
        setDateValue({
            cellElements: options.cellElements,
            data: options.data,
            protyle: options.protyle,
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
            protyle: options.protyle,
            value: {
                hasEndDate: inputElements[2].checked
            }
        });
    });
    inputElements[3].addEventListener("change", () => {
        if (inputElements[3].checked) {
            inputElements[0].setAttribute("type", "datetime-local");
            inputElements[1].setAttribute("type", "datetime-local");
            inputElements[0].value = inputElements[0].dataset.value
            inputElements[1].value = inputElements[1].dataset.value
        } else {
            inputElements[0].setAttribute("type", "date");
            inputElements[1].setAttribute("type", "date");
            inputElements[0].value = inputElements[0].dataset.value.substring(0, 10)
            inputElements[1].value = inputElements[1].dataset.value.substring(0, 10)
        }
        setDateValue({
            cellElements: options.cellElements,
            data: options.data,
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
    value: IAVCellDateValue
}) => {
    let cellIndex: number;
    Array.from(options.cellElements[0].parentElement.querySelectorAll(".av__cell")).find((item: HTMLElement, index) => {
        if (item.dataset.id === options.cellElements[0].dataset.id) {
            cellIndex = index;
            return true;
        }
    });
    const colId = options.cellElements[0].dataset.colId;
    const cellDoOperations: IOperation[] = [];
    const cellUndoOperations: IOperation[] = [];
    options.cellElements.forEach(item => {
        let cellData: IAVCell;
        let oldValue;
        const rowID = item.parentElement.dataset.id;
        options.data.view.rows.find(row => {
            if (row.id === rowID) {
                if (typeof cellIndex === "number") {
                    cellData = row.cells[cellIndex];
                    // 为空时 cellId 每次请求都不一致
                    cellData.id = item.dataset.id;
                    if (!cellData.value) {
                        cellData.value = {};
                    }
                } else {
                    cellData = row.cells.find(cellItem => {
                        if (item.dataset.id === cellItem.id) {
                            return true;
                        }
                    });
                }
                oldValue = Object.assign({}, cellData.value.date);
                cellData.value.date = Object.assign(cellData.value.date || {
                    isNotEmpty2: false,
                    isNotEmpty: false
                }, options.value);
                return true;
            }
        });

        cellDoOperations.push({
            action: "updateAttrViewCell",
            id: cellData.id,
            keyID: colId,
            rowID,
            avID: options.data.id,
            data: cellData.value
        });
        cellUndoOperations.push({
            action: "updateAttrViewCell",
            id: cellData.id,
            keyID: colId,
            rowID,
            avID: options.data.id,
            data: {
                date: oldValue
            }
        });
        if (item.classList.contains("custom-attr__avvalue")) {
            item.innerHTML = genAVValueHTML(cellData.value);
        } else {
            updateAttrViewCellAnimation(item);
        }
    });
    transaction(options.protyle, cellDoOperations, cellUndoOperations);
};
