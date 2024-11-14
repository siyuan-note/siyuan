import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {fetchSyncPost} from "../../../util/fetch";

const calcItem = (options: {
    menu: Menu,
    protyle: IProtyle,
    operator: string,
    oldOperator: string,
    colId: string,
    data?: IAV, // rollup
    target: HTMLElement,
    avId: string,
    blockID: string
}) => {
    options.menu.addItem({
        iconHTML: "",
        label: getNameByOperator(options.operator, !!options.data),
        click() {
            if (!options.data) {
                transaction(options.protyle, [{
                    action: "setAttrViewColCalc",
                    avID: options.avId,
                    id: options.colId,
                    data: {
                        operator: options.operator
                    },
                    blockID: options.blockID
                }], [{
                    action: "setAttrViewColCalc",
                    avID: options.avId,
                    id: options.colId,
                    data: {
                        operator: options.oldOperator
                    },
                    blockID: options.blockID
                }]);
            } else {
                options.target.querySelector(".b3-menu__accelerator").textContent = getNameByOperator(options.operator, true);
                const colData = options.data.view.columns.find((item) => {
                    if (item.id === options.colId) {
                        if (!item.rollup) {
                            item.rollup = {};
                        }
                        return true;
                    }
                });
                colData.rollup.calc = {
                    operator: options.operator
                };
                transaction(options.protyle, [{
                    action: "updateAttrViewColRollup",
                    id: options.colId,
                    avID: options.avId,
                    parentID: colData.rollup.relationKeyID,
                    keyID: colData.rollup.keyID,
                    data: {
                        calc: colData.rollup.calc,
                    },
                }], [{
                    action: "updateAttrViewColRollup",
                    id: options.colId,
                    avID: options.avId,
                    parentID: colData.rollup.relationKeyID,
                    keyID: colData.rollup.keyID,
                    data: {
                        calc: {
                            operator: options.oldOperator
                        },
                    }
                }]);
            }
        }
    });
};

export const openCalcMenu = async (protyle: IProtyle, calcElement: HTMLElement, panelData?: {
    data: IAV,
    colId: string,
    blockID: string
}) => {
    let rowElement: HTMLElement | false;
    let type;
    let colId: string;
    let avId: string;
    let oldOperator: string;
    let blockID: string;
    if (panelData) {
        avId = panelData.data.id;
        type = calcElement.dataset.colType as TAVCol;
        oldOperator = calcElement.dataset.calc;
        colId = panelData.colId;
        blockID = panelData.blockID;
    } else {
        const blockElement = hasClosestBlock(calcElement);
        if (!blockElement) {
            return;
        }
        rowElement = hasClosestByClassName(calcElement, "av__row--footer");
        if (!rowElement) {
            return;
        }
        rowElement.classList.add("av__row--show");
        type = calcElement.dataset.dtype as TAVCol;
        colId = calcElement.dataset.colId;
        avId = blockElement.dataset.avId;
        oldOperator = calcElement.dataset.operator;
        blockID = blockElement.dataset.nodeId;
    }
    if (type === "lineNumber") {
        return;
    }
    const menu = new Menu("av-calc", () => {
        if (rowElement) {
            rowElement.classList.remove("av__row--show");
        }
    });
    if (menu.isOpen) {
        return;
    }
    calcItem({
        menu,
        protyle,
        colId,
        avId,
        oldOperator,
        operator: "",
        data: panelData?.data,
        blockID,
        target: calcElement
    });
    calcItem({
        menu,
        protyle,
        colId,
        avId,
        oldOperator,
        operator: "Count all",
        data: panelData?.data,
        blockID,
        target: calcElement
    });
    if (type !== "checkbox") {
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Count empty",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Count not empty",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Count values",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Count unique values",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Percent empty",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Percent not empty",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
    } else {
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Checked",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Unchecked",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Percent checked",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Percent unchecked",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
    }
    let rollupIsNumber = false;
    if (type === "rollup") {
        let relationKeyID: string;
        let keyID: string;
        let avData = panelData?.data;
        if (!avData) {
            const avResponse = await fetchSyncPost("api/av/renderAttributeView", {id: avId});
            avData = avResponse.data;
        }
        avData.view.columns.find((item) => {
            if (item.id === colId) {
                relationKeyID = item.rollup?.relationKeyID;
                keyID = item.rollup?.keyID;
                return true;
            }
        });
        if (relationKeyID && keyID) {
            let relationAvId: string;
            avData.view.columns.find((item) => {
                if (item.id === relationKeyID) {
                    relationAvId = item.relation?.avID;
                    return true;
                }
            });
            if (relationAvId) {
                const colResponse = await fetchSyncPost("api/av/getAttributeView", {id: relationAvId});
                colResponse.data.av.keyValues.find((item: { key: { id: string, name: string, type: TAVCol } }) => {
                    if (item.key.id === keyID) {
                        rollupIsNumber = item.key.type === "number";
                        return true;
                    }
                });
            }
        }
    }
    if (["number", "template"].includes(type) || rollupIsNumber) {
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Sum",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Average",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Median",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Min",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Max",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Range",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
    } else if (["date", "created", "updated"].includes(type)) {
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Earliest",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Latest",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Range",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
    }
    const calcRect = calcElement.getBoundingClientRect();
    menu.open({x: calcRect.left, y: calcRect.bottom, h: calcRect.height});
};

export const getCalcValue = (column: IAVColumn) => {
    if (!column.calc || !column.calc.result) {
        return "";
    }
    let resultCalc: any = column.calc.result.number;
    if (column.calc.operator === "Earliest" || column.calc.operator === "Latest" ||
        (column.calc.operator === "Range" && ["date", "created", "updated"].includes(column.type))) {
        resultCalc = column.calc.result[column.type as "date"];
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
        case  "Checked":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.checked}`;
            break;
        case  "Unchecked":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.unchecked}`;
            break;
        case  "Percent checked":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.percentChecked}`;
            break;
        case  "Percent unchecked":
            value = `<span>${resultCalc.formattedContent}</span>${window.siyuan.languages.percentUnchecked}`;
            break;
    }
    return value;
};

export const getNameByOperator = (operator: string, isRollup: boolean) => {
    switch (operator) {
        case undefined:
        case "":
            return isRollup ? window.siyuan.languages.original : window.siyuan.languages.calcOperatorNone;
        case "Count all":
            return window.siyuan.languages.calcOperatorCountAll;
        case "Count values":
            return window.siyuan.languages.calcOperatorCountValues;
        case "Count unique values":
            return window.siyuan.languages.calcOperatorCountUniqueValues;
        case "Count empty":
            return window.siyuan.languages.calcOperatorCountEmpty;
        case "Count not empty":
            return window.siyuan.languages.calcOperatorCountNotEmpty;
        case "Percent empty":
            return window.siyuan.languages.calcOperatorPercentEmpty;
        case "Percent not empty":
            return window.siyuan.languages.calcOperatorPercentNotEmpty;
        case "Checked":
            return window.siyuan.languages.checked;
        case "Unchecked":
            return window.siyuan.languages.unchecked;
        case "Percent checked":
            return window.siyuan.languages.percentChecked;
        case "Percent unchecked":
            return window.siyuan.languages.percentUnchecked;
        case "Sum":
            return window.siyuan.languages.calcOperatorSum;
        case "Average":
            return window.siyuan.languages.calcOperatorAverage;
        case "Median":
            return window.siyuan.languages.calcOperatorMedian;
        case "Min":
            return window.siyuan.languages.calcOperatorMin;
        case "Max":
            return window.siyuan.languages.calcOperatorMax;
        case "Range":
            return window.siyuan.languages.calcOperatorRange;
        case "Earliest":
            return window.siyuan.languages.calcOperatorEarliest;
        case "Latest":
            return window.siyuan.languages.calcOperatorLatest;
        default:
            return "";
    }
};
