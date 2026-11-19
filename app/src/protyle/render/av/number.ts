import {transaction} from "../../wysiwyg/transaction";
import {getAllEditor} from "../../../layout/getAll";

const refreshDatabaseAttributePanels = (protyle: IProtyle, avID: string) => {
    protyle.databaseAttributePanel?.refresh();
    getAllEditor().forEach((editor) => {
        if (editor.protyle !== protyle && editor.protyle.databaseAttributePanel?.hasDatabase(avID)) {
            editor.protyle.databaseAttributePanel.refresh();
        }
    });
};

export const setNumberFieldFormat = (protyle: IProtyle, avID: string, colId: string, format: string, oldFormat: string) => {
    transaction(protyle, [{action: "updateAttrViewColNumberFormat", id: colId, avID, format, type: "number"}],
        [{action: "updateAttrViewColNumberFormat", id: colId, avID, format: oldFormat, type: "number"}], {
            callback: () => refreshDatabaseAttributePanels(protyle, avID),
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
