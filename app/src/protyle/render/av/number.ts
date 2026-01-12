import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {Constants} from "../../../constants";

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
    const menu = new Menu(Constants.MENU_AV_COL_FORMAT_NUMBER);
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
        format: "USD",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "CNY",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "EUR",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "GBP",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "JPY",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "RUB",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "INR",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "KRW",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format:"TRY",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "CAD",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "CHF",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "THB",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "AUD",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "HKD",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "TWD",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "MOP",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "SGD",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format: "NZD",
        oldFormat: options.oldFormat,
        avPanelElement: options.avPanelElement,
    });
    addFormatItem({
        menu,
        protyle: options.protyle,
        colId: options.colId,
        avID: options.avID,
        format:"ILS",
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
    if ("" === format) {
        return window.siyuan.languages.numberFormatNone;
    } else if ("commas" === format) {
        return window.siyuan.languages.numberFormatCommas;
    } else if ("percent" === format) {
        return window.siyuan.languages.numberFormatPercent;
    }

    return window.siyuan.languages["numberFormat" + format];
};
