import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";

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
    const rowElement = hasClosestByClassName(calcElement, "av__row--footer");
    if (!rowElement) {
        return;
    }
    rowElement.classList.add("av__row--show");
    const menu = new Menu("av-calc", () => {
        rowElement.classList.remove("av__row--show");
    });
    if (menu.isOpen) {
        return;
    }
    const type = calcElement.dataset.dtype as TAVCol;
    const colId = calcElement.dataset.colId;
    const avId = blockElement.dataset.avId;
    const oldOperator = calcElement.dataset.operator;
    if (type !== "checkbox") {
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "",
            label: window.siyuan.languages.calcOperatorNone
        });
    }
    calcItem({
        menu,
        protyle,
        colId,
        avId,
        oldOperator,
        operator: "Count all",
        label: window.siyuan.languages.calcOperatorCountAll
    });
    if (type !== "checkbox") {
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
    } else {
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Checked",
            label: window.siyuan.languages.checked
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Unchecked",
            label: window.siyuan.languages.unchecked
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Percent checked",
            label: window.siyuan.languages.percentChecked
        });
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Percent unchecked",
            label: window.siyuan.languages.percentUnchecked
        });
    }
    if (["number", "template"].includes(type)) {
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
    } else if (["date", "created", "updated"].includes(type)) {
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
