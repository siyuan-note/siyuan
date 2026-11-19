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

export const setDateFieldFormat = (protyle: IProtyle, avID: string, colId: string,
                                   type: "date" | "created" | "updated", format: TAVDateFormat, oldFormat: TAVDateFormat) => {
    transaction(protyle, [{action: "setAttrViewColDateFormat", id: colId, avID, format, type}],
        [{action: "setAttrViewColDateFormat", id: colId, avID, format: oldFormat, type}], {
            callback: () => refreshDatabaseAttributePanels(protyle, avID),
        });
};
