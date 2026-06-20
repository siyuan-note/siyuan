import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {fetchSyncPost} from "../../../util/fetch";
import {getFieldsByData} from "./view";
import {Constants} from "../../../constants";
import {Dialog} from "../../../dialog";
import {escapeAttr} from "../../../util/escape";

const calcItem = (options: {
    menu: Menu,
    protyle: IProtyle,
    operator: string,
    oldOperator: string,
    colId: string,
    data?: IAV, // rollup
    target: HTMLElement,
    avId: string,
    blockID: string,
    template?: string,
    oldTemplate?: string
}) => {
    options.menu.addItem({
        iconHTML: "",
        label: getNameByOperator(options.operator, !!options.data),
        click() {
            if (!options.data) {
                const doData: IAVCalc = {operator: options.operator};
                if (options.operator === "Template" && options.template) {
                    doData.template = options.template;
                }
                const undoData: IAVCalc = {operator: options.oldOperator};
                if (options.oldOperator === "Template" && options.oldTemplate) {
                    undoData.template = options.oldTemplate;
                }
                transaction(options.protyle, [{
                    action: "setAttrViewColCalc",
                    avID: options.avId,
                    id: options.colId,
                    data: doData,
                    blockID: options.blockID
                }], [{
                    action: "setAttrViewColCalc",
                    avID: options.avId,
                    id: options.colId,
                    data: undoData,
                    blockID: options.blockID
                }]);
            } else {
                options.target.querySelector(".b3-menu__accelerator").textContent = getNameByOperator(options.operator, true);
                const colData = getFieldsByData(options.data).find((item) => {
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
}, x?: number) => {
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
    const menu = new Menu(Constants.MENU_AV_CALC, () => {
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
    if (panelData?.data && type !== "checkbox") {
        // 汇总字段汇总方式中才有“显示唯一值”选项 Add "Show unique values" to the calculation of the database rollup field https://github.com/siyuan-note/siyuan/issues/15852
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Unique values",
            data: panelData?.data,
            blockID,
            target: calcElement
        });
    }
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
        calcItem({
            menu,
            protyle,
            colId,
            avId,
            oldOperator,
            operator: "Percent unique values",
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
        // 行级汇总结果本身就是数字的操作（如计数、百分比、复选统计），即使目标字段不是数字类型，
        // 底部计算也应支持 Sum/Average 等数字计算方式
        const numericRowCalcOperators = [
            "Count all", "Count values", "Count unique values", "Count empty", "Count not empty",
            "Percent empty", "Percent not empty", "Percent unique values",
            "Checked", "Unchecked", "Percent checked", "Percent unchecked",
        ];
        let relationKeyID: string;
        let keyID: string;
        let rowCalcOperator: string;
        let avData = panelData?.data;
        if (!avData) {
            const avResponse = await fetchSyncPost("/api/av/renderAttributeView", {id: avId});
            avData = avResponse.data;
        }

        getFieldsByData(avData).find((item) => {
            if (item.id === colId) {
                relationKeyID = item.rollup?.relationKeyID;
                keyID = item.rollup?.keyID;
                rowCalcOperator = item.rollup?.calc?.operator;
                return true;
            }
        });
        if (numericRowCalcOperators.includes(rowCalcOperator)) {
            rollupIsNumber = true;
        }
        if (relationKeyID && keyID) {
            let relationAvId: string;
            getFieldsByData(avData).find((item) => {
                if (item.id === relationKeyID) {
                    relationAvId = item.relation?.avID;
                    return true;
                }
            });
            if (relationAvId) {
                const colResponse = await fetchSyncPost("/api/av/getAttributeView", {id: relationAvId});
                colResponse.data.av.keyValues.find((item: { key: { id: string, name: string, type: TAVCol } }) => {
                    if (item.key.id === keyID) {
                        rollupIsNumber = item.key.type === "number" || rollupIsNumber;
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
    // 底部计算支持自定义模板统计
    // 获取当前列已有的模板内容（footer 路径下需异步拉取列数据）
    let currentTemplate = "";
    if (panelData?.data) {
        const colData = getFieldsByData(panelData.data).find((item) => item.id === colId);
        currentTemplate = colData?.calc?.template || "";
    } else {
        const avResponse = await fetchSyncPost("/api/av/renderAttributeView", {id: avId});
        const colData = getFieldsByData(avResponse.data).find((item) => item.id === colId);
        currentTemplate = colData?.calc?.template || "";
    }
    // 提交模板统计：将底部计算切换为 Template 并写入模板内容；模板为空时恢复为“无”
    const submitTemplate = (templateContent: string) => {
        const isEmpty = "" === templateContent.trim();
        const doData: IAVCalc = isEmpty ? {operator: ""} : {operator: "Template", template: templateContent};
        const undoData: IAVCalc = {operator: oldOperator || ""};
        if (oldOperator === "Template" && currentTemplate) {
            undoData.template = currentTemplate;
        }
        transaction(protyle, [{
            action: "setAttrViewColCalc",
            avID: avId,
            id: colId,
            data: doData,
            blockID
        }], [{
            action: "setAttrViewColCalc",
            avID: avId,
            id: colId,
            data: undoData,
            blockID
        }]);
    };
    menu.addItem({
        iconHTML: "",
        label: getNameByOperator("Template", !!panelData?.data),
        click() {
            menu.close();
            const dialog = new Dialog({
                title: window.siyuan.languages.calcOperatorTemplate,
                content: `<div class="b3-dialog__content">
    <textarea spellcheck="false" class="fn__block b3-text-field" placeholder="${escapeAttr(window.siyuan.languages.rollupTemplateTip)}" rows="8" style="resize: vertical;font-family: var(--b3-font-family-code);">${currentTemplate}</textarea>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                width: "520px",
            });
            const textarea = dialog.element.querySelector("textarea") as HTMLTextAreaElement;
            const confirmBtn = dialog.element.querySelector(".b3-button--text") as HTMLButtonElement;
            const cancelBtn = dialog.element.querySelector(".b3-button--cancel") as HTMLButtonElement;
            const confirm = () => {
                submitTemplate(textarea.value);
                dialog.destroy();
            };
            confirmBtn.addEventListener("click", confirm);
            cancelBtn.addEventListener("click", () => {
                dialog.destroy();
            });
            dialog.bindInput(textarea, confirm);
            textarea.focus();
        }
    });
    const calcRect = calcElement.getBoundingClientRect();
    menu.open({x: Math.max(x || 0, calcRect.left), y: calcRect.bottom, h: calcRect.height});
};

export const getCalcValue = (column: IAVColumn) => {
    if (!column.calc || !column.calc.result) {
        return "";
    }
    let resultCalc: any = column.calc.result.number;
    if (column.calc.operator === "Earliest" || column.calc.operator === "Latest" ||
        (column.calc.operator === "Range" && ["date", "created", "updated"].includes(column.type))) {
        resultCalc = column.calc.result[column.type as "date"];
    } else if (column.calc.operator === "Template") {
        // 自定义模板统计：数字输出走 number，文本输出走 text
        resultCalc = column.calc.result.number || column.calc.result.text;
    }
    let value = "";
    switch (column.calc.operator) {
        case "Count all":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcResultCountAll}</small>`;
            break;
        case "Count values":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcResultCountValues}</small>`;
            break;
        case "Count unique values":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcResultCountUniqueValues}</small>`;
            break;
        case "Count empty":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcResultCountEmpty}</small>`;
            break;
        case "Count not empty":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcResultCountNotEmpty}</small>`;
            break;
        case "Percent empty":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcResultPercentEmpty}</small>`;
            break;
        case "Percent not empty":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcResultPercentNotEmpty}</small>`;
            break;
        case "Percent unique values":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcResultPercentUniqueValues}</small>`;
            break;
        case "Sum":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcResultSum}</small>`;
            break;
        case  "Average":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcResultAverage}</small>`;
            break;
        case  "Median":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcResultMedian}</small>`;
            break;
        case  "Min":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcResultMin}</small>`;
            break;
        case  "Max":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcResultMax}</small>`;
            break;
        case  "Range":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcResultRange}</small>`;
            break;
        case  "Earliest":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcOperatorEarliest}</small>`;
            break;
        case  "Latest":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.calcOperatorLatest}</small>`;
            break;
        case  "Checked":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.checked}</small>`;
            break;
        case  "Unchecked":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.unchecked}</small>`;
            break;
        case  "Percent checked":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.percentChecked}</small>`;
            break;
        case  "Percent unchecked":
            value = `<span>${resultCalc.formattedContent}</span><small>${window.siyuan.languages.percentUnchecked}</small>`;
            break;
        case  "Template":
            value = `<span>${resultCalc.formattedContent ?? resultCalc.content}</span><small>${window.siyuan.languages.calcResultTemplate}</small>`;
            break;
    }
    return value;
};

export const getNameByOperator = (operator: string, isRollup: boolean) => {
    switch (operator) {
        case undefined:
        case "":
            return isRollup ? window.siyuan.languages.original : window.siyuan.languages.calcOperatorNone;
        case "Unique values": // 仅汇总字段的汇总方式在使用
            return window.siyuan.languages.uniqueValues;
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
        case "Percent unique values":
            return window.siyuan.languages.calcOperatorPercentUniqueValues;
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
        case "Template":
            return window.siyuan.languages.calcOperatorTemplate;
        default:
            return "";
    }
};
