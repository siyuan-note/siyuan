import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";

const addFormatItem = (options: {
    menu: Menu,
    protyle: IProtyle,
    colId: string,
    avID: string,
    format: string,
    oldFormat: string
    avPanelElement: Element
}) => {
    options.menu.addItem({
        iconHTML: "",
        label: getLabelByNumberFormat(options.format),
        click() {
            transaction(options.protyle, [{
                action: "updateAttrViewColNumberFormat",
                id: options.colId,
                avID: options.avID,
                format: options.format,
                type: "number",
            }], [{
                action: "updateAttrViewColNumberFormat",
                id: options.colId,
                avID: options.avID,
                format: options.oldFormat,
                type: "number",
            }]);
            options.avPanelElement.remove();
        }
    });
};

export const formatNumber = (options: {
    avPanelElement: Element,
    element: HTMLElement,
    protyle: IProtyle,
    colId: string,
    avID: string,
    oldFormat: string
}) => {
    const menu = new Menu("av-col-format-number");
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "commas",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "percent",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "usDollar",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "yuan",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "euro",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "pound",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "yen",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "ruble",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "rupee",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "won",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "canadianDollar",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "franc",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    const rect = options.element.getBoundingClientRect();
    menu.open({
        x: rect.left,
        y: rect.bottom,
        h: rect.height,
        w: rect.width,
        isLeft: true,
    });
};

export const getLabelByNumberFormat = (format: string) => {
    switch (format) {
        case "":
            return window.siyuan.languages.numberFormatNone;
        case "commas":
            return window.siyuan.languages.numberFormatCommas;
        case "percent":
            return window.siyuan.languages.numberFormatPercent;
        case "usDollar":
            return window.siyuan.languages.numberFormatUSDollar;
        case "yuan":
            return window.siyuan.languages.numberFormatYuan;
        case "euro":
            return window.siyuan.languages.numberFormatEuro;
        case "pound":
            return window.siyuan.languages.numberFormatPound;
        case "yen":
            return window.siyuan.languages.numberFormatYen;
        case "ruble":
            return window.siyuan.languages.numberFormatRuble;
        case "rupee":
            return window.siyuan.languages.numberFormatRupee;
        case "won":
            return window.siyuan.languages.numberFormatWon;
        case "canadianDollar":
            return window.siyuan.languages.numberFormatCanadianDollar;
        case "franc":
            return window.siyuan.languages.numberFormatFranc;
    }
};
