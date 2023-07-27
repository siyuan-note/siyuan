import {transaction} from "../../wysiwyg/transaction";
import * as dayjs from "dayjs";

export const getDateHTML = (data: IAVTable, cellElements: HTMLElement[]) => {
    let hasEndDate = true;
    let cellValue:IAVCell;
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
    if (cellValue?.value?.date?.content) {
        value = dayjs(cellValue.value.date.content).format("YYYY-MM-DDTHH:mm");
    }
    let value2 = "";
    if (cellValue?.value?.date?.content2) {
        value2 = dayjs(cellValue.value.date.content2).format("YYYY-MM-DDTHH:mm");
    }
    return `<div class="b3-menu__items">
<div>
    <input type="datetime-local" value="${value}" class="b3-text-field fn__size200"><br>
    <input type="datetime-local" value="${value2}" style="margin-top: 8px" class="b3-text-field fn__size200${hasEndDate ? "" : " fn__none"}">
    <button class="b3-menu__separator"></button>
    <button class="b3-menu__item">
        <span>${window.siyuan.languages.endDate}</span>
        <span class="fn__space fn__flex-1"></span>
        <input type="checkbox" class="b3-switch fn__flex-center"${hasEndDate ? " checked" : ""}>
    </button>
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
    const inputElements: NodeListOf<HTMLInputElement> = options.menuElement.querySelectorAll(".b3-text-field");
    inputElements[0].addEventListener("change", () => {
        setDateValue({
            cellElements: options.cellElements,
            data: options.data,
            protyle: options.protyle,
            value: {
                content: new Date(inputElements[0].value).getTime()
            }
        });
    });
    inputElements[1].addEventListener("change", () => {
        setDateValue({
            cellElements: options.cellElements,
            data: options.data,
            protyle: options.protyle,
            value: {
                content2: new Date(inputElements[1].value).getTime()
            }
        });
    });
    const checkElement = options.menuElement.querySelector(".b3-switch") as HTMLInputElement;
    checkElement.addEventListener("change", () => {
        if (checkElement.checked) {
            inputElements[1].classList.remove("fn__none");
        } else {
            inputElements[1].classList.add("fn__none");
        }
        setDateValue({
            cellElements: options.cellElements,
            data: options.data,
            protyle: options.protyle,
            value: {
                hasEndDate: checkElement.checked
            }
        });
    });
};

export const setDateValue = (options: {
    cellElements: HTMLElement[],
    data: IAV
    protyle: IProtyle,
    value: {
        content?: number,
        content2?: number,
        hasEndDate?: boolean
    }
}) => {
    let cellIndex = 0;
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
                cellData = row.cells[cellIndex];
                // 为空时 cellId 每次请求都不一致
                cellData.id = item.dataset.id;
                if (!cellData.value) {
                    cellData.value = {};
                }
                oldValue = Object.assign({}, cellData.value.date);
                cellData.value.date = Object.assign(cellData.value.date || {}, options.value);
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
    });
    transaction(options.protyle, cellDoOperations, cellUndoOperations);
};
