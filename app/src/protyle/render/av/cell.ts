import {transaction} from "../../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {openMenuPanel} from "./openMenuPanel";
import {Menu} from "../../../plugin/Menu";

export const getCalcValue = (column: IAVColumn) => {
    if (!column.calc || !column.calc.result) {
        return "";
    }
    let resultCalc: any = column.calc.result.number;
    if (column.calc.operator === "Earliest" || column.calc.operator === "Latest" ||
        (column.calc.operator === "Range" && column.type === "date")) {
        resultCalc = column.calc.result.date;
    }
    let value = "";
    switch (column.calc.operator) {
        case "Count all":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcResultCountAll}`;
            break;
        case "Count values":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcResultCountValues}`;
            break;
        case "Count unique values":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcResultCountUniqueValues}`;
            break;
        case "Count empty":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcResultCountEmpty}`;
            break;
        case "Count not empty":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcResultCountNotEmpty}`;
            break;
        case "Percent empty":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcResultPercentEmpty}`;
            break;
        case "Percent not empty":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcResultPercentNotEmpty}`;
            break;
        case "Sum":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcResultSum}`;
            break;
        case  "Average":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcResultAverage}`;
            break;
        case  "Median":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcResultMedian}`;
            break;
        case  "Min":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcResultMin}`;
            break;
        case  "Max":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcResultMax}`;
            break;
        case  "Range":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcResultRange}`;
            break;
        case  "Earliest":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcOperatorEarliest}`;
            break;
        case  "Latest":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.calcOperatorLatest}`;
            break;
    }
    return value;
};

export const genCellValue = (colType: TAVCol, value: string | {
    content: string,
    color: string
}[] | IAVCellDateValue) => {
    let cellValue: IAVCellValue;
    if (typeof value === "string") {
        if (colType === "number") {
            if (value) {
                cellValue = {
                    type: colType,
                    number: {
                        content: parseFloat(value),
                        isNotEmpty: true
                    }
                };
            } else {
                cellValue = {
                    type: colType,
                    number: {
                        isNotEmpty: false
                    }
                };
            }
        } else if (["text", "block", "url", "phone", "email"].includes(colType)) {
            cellValue = {
                type: colType,
                [colType]: {
                    content: value
                }
            };
        } else if (colType === "mSelect" || colType === "select") {
            cellValue = {
                type: colType,
                mSelect: [{
                    content: value,
                    color: ""
                }]
            };
        } else if (colType === "date" && value === "") {
            cellValue = {
                type: colType,
                date: {
                    content: null,
                    isNotEmpty: false,
                    content2: null,
                    isNotEmpty2: false,
                    hasEndDate: false,
                }
            };
        }
    } else {
        if (colType === "mSelect" || colType === "select") {
            cellValue = {
                type: colType,
                mSelect: value as {
                    content: string,
                    color: string
                }[]
            };
        } else if (colType === "date") {
            cellValue = {
                type: colType,
                date: value as IAVCellDateValue
            };
        }
    }
    return cellValue;
};

const calcItem = (options: {
    menu: Menu,
    protyle: IProtyle,
    label: string,
    operator: string,
    oldOperator: string,
    colId: string,
    avId: string
}) => {
    options.menu.addItem({
        iconHTML: "",
        label: options.label,
        click() {
            transaction(options.protyle, [{
                action: "setAttrViewColCalc",
                avID: options.avId,
                id: options.colId,
                data: {
                    operator: options.operator
                }
            }], [{
                action: "setAttrViewColCalc",
                avID: options.avId,
                id: options.colId,
                data: {
                    operator: options.oldOperator
                }
            }]);
        }
    });
};
export const openCalcMenu = (protyle: IProtyle, calcElement: HTMLElement) => {
    const blockElement = hasClosestBlock(calcElement);
    if (!blockElement) {
        return;
    }
    calcElement.parentElement.classList.add("av__row--show");
    const menu = new Menu("av-calc", () => {
        calcElement.parentElement.classList.remove("av__row--show");
    });
    if (menu.isOpen) {
        return;
    }
    const type = calcElement.dataset.dtype as TAVCol;
    const colId = calcElement.dataset.colId;
    const avId = blockElement.dataset.avId;
    const oldOperator = calcElement.dataset.operator;
    calcItem({
        menu,
        protyle,
        colId,
        avId,
        oldOperator,
        operator: "",
        label: window.siyuan.languages.calcOperatorNone
    });
    calcItem({
        menu,
        protyle,
        colId,
        avId,
        oldOperator,
        operator: "Count all",
        label: window.siyuan.languages.calcOperatorCountAll
    });
    calcItem({
        menu,
        protyle,
        colId,
        avId,
        oldOperator,
        operator: "Count values",
        label: window.siyuan.languages.calcOperatorCountValues
    });
    calcItem({
        menu,
        protyle,
        colId,
        avId,
        oldOperator,
        operator: "Count unique values",
        label: window.siyuan.languages.calcOperatorCountUniqueValues
    });
    calcItem({
        menu,
        protyle,
        colId,
        avId,
        oldOperator,
        operator: "Count empty",
        label: window.siyuan.languages.calcOperatorCountEmpty
    });
    calcItem({
        menu,
        protyle,
        colId,
        avId,
        oldOperator,
        operator: "Count not empty",
        label: window.siyuan.languages.calcOperatorCountNotEmpty
    });
    calcItem({
        menu,
        protyle,
        colId,
        avId,
        oldOperator,
        operator: "Percent empty",
        label: window.siyuan.languages.calcOperatorPercentEmpty
    });
    calcItem({
        menu,
        protyle,
        colId,
        avId,
        oldOperator,
        operator: "Percent not empty",
        label: window.siyuan.languages.calcOperatorPercentNotEmpty
    });
    if (type === "number") {
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Sum",
            label: window.siyuan.languages.calcOperatorSum
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Average",
            label: window.siyuan.languages.calcOperatorAverage
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Median",
            label: window.siyuan.languages.calcOperatorMedian
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Min",
            label: window.siyuan.languages.calcOperatorMin
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Max",
            label: window.siyuan.languages.calcOperatorMax
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Range",
            label: window.siyuan.languages.calcOperatorRange
        });
    } else if (type === "date") {
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Earliest",
            label: window.siyuan.languages.calcOperatorEarliest
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Latest",
            label: window.siyuan.languages.calcOperatorLatest
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Range",
            label: window.siyuan.languages.calcOperatorRange
        });
    }
    const calcRect = calcElement.getBoundingClientRect();
    menu.open({x: calcRect.left, y: calcRect.bottom, h: calcRect.height});
};

export const popTextCell = (protyle: IProtyle, cellElements: HTMLElement[]) => {
    const type = cellElements[0].parentElement.parentElement.firstElementChild.querySelector(`[data-col-id="${cellElements[0].getAttribute("data-col-id")}"]`).getAttribute("data-dtype") as TAVCol;
    if (type === "block") {
        return;
    }
    const cellRect = cellElements[0].getBoundingClientRect();
    let html = "";
    const style = `style="position:absolute;left: ${cellRect.left}px;top: ${cellRect.top}px;width:${Math.max(cellRect.width, 200)}px;height: ${cellRect.height}px"`;
    const blockElement = hasClosestBlock(cellElements[0]);
    if (["text", "url", "email", "phone"].includes(type)) {
        html = `<textarea ${style} class="b3-text-field">${cellElements[0].firstElementChild.textContent}</textarea>`;
    } else if (type === "number") {
        html = `<input type="number" value="${cellElements[0].firstElementChild.getAttribute("data-content")}" ${style} class="b3-text-field">`;
    } else if (["select", "mSelect"].includes(type) && blockElement) {
        openMenuPanel({protyle, blockElement, type: "select", cellElements});
        return;
    } else if (type === "date" && blockElement) {
        openMenuPanel({protyle, blockElement, type: "date", cellElements});
        return;
    }
    window.siyuan.menus.menu.remove();
    document.body.insertAdjacentHTML("beforeend", `<div class="av__mask" style="z-index: ${++window.siyuan.zIndex}">
    ${html}
</div>`);
    const avMaskElement = document.querySelector(".av__mask");
    const inputElement = avMaskElement.querySelector(".b3-text-field") as HTMLInputElement;
    if (inputElement) {
        inputElement.select();
        inputElement.focus();
        inputElement.addEventListener("blur", () => {
            updateCellValue(protyle, type, cellElements);
        });
        inputElement.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                return;
            }
            if (event.key === "Escape" || event.key === "Enter") {
                updateCellValue(protyle, type, cellElements);
                event.preventDefault();
                event.stopPropagation();
            }
        });
    }
    avMaskElement.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).classList.contains("av__mask")) {
            avMaskElement?.remove();
        }
    });
};

const updateCellValue = (protyle: IProtyle, type: TAVCol, cellElements: HTMLElement[]) => {
    const blockElement = hasClosestBlock(cellElements[0]);
    if (!blockElement) {
        return;
    }

    const avMaskElement = document.querySelector(".av__mask");
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    const avID = blockElement.getAttribute("data-av-id");
    cellElements.forEach((item) => {
        const rowElement = hasClosestByClassName(item, "av__row");
        if (!rowElement) {
            return;
        }
        const rowID = rowElement.getAttribute("data-id");
        const cellId = item.getAttribute("data-id");
        const colId = item.getAttribute("data-col-id");
        const inputValue: { content: string | number, isNotEmpty?: boolean } = {
            content: (avMaskElement.querySelector(".b3-text-field") as HTMLInputElement).value
        };
        const oldValue: { content: string | number, isNotEmpty?: boolean } = {
            content: item.textContent.trim()
        };
        if (type === "number") {
            oldValue.content = parseFloat(oldValue.content as string);
            oldValue.isNotEmpty = !!oldValue.content;
            inputValue.content = parseFloat(inputValue.content as string);
            inputValue.isNotEmpty = !!inputValue.content;
        }
        doOperations.push({
            action: "updateAttrViewCell",
            id: cellId,
            avID,
            keyID: colId,
            rowID,
            data: {
                [type]: inputValue
            }
        });
        undoOperations.push({
            action: "updateAttrViewCell",
            id: cellId,
            avID,
            keyID: colId,
            rowID,
            data: {
                [type]: oldValue
            }
        });
    });
    transaction(protyle, doOperations, undoOperations);
    setTimeout(() => {
        avMaskElement.remove();
    });
};
