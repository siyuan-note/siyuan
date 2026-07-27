import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {Constants} from "../../../constants";
import {getAllEditor, getAllModels} from "../../../layout/getAll";
import {formatDateDisplay, getLabelByDateFormat} from "./dateFormat";

const refreshDatabaseAttributePanels = (protyle: IProtyle, avID: string) => {
    protyle.databaseAttributePanel?.refresh();
    getAllEditor().forEach((editor) => {
        if (editor.protyle !== protyle && editor.protyle.databaseAttributePanel?.hasDatabase(avID)) {
            editor.protyle.databaseAttributePanel.refresh();
        }
    });
    /// #if !MOBILE
    getAllModels().custom.forEach((model) => {
        if (model.type === "siyuan-database-row" && model.data.avID === avID) {
            model.update?.();
        }
    });
    /// #endif
};

export const formatDate = (options: {
    avPanelElement: Element,
    element: HTMLElement,
    protyle: IProtyle,
    colId: string,
    avID: string,
    type: "date" | "created" | "updated",
    oldFormat: TAVDateFormat
}) => {
    const menu = new Menu(Constants.MENU_AV_COL_FORMAT_DATE);
    (["", "full", "month-day-year", "day-month-year", "year-month-day"] as TAVDateFormat[]).forEach((format) => {
        menu.addItem({
            checked: format === options.oldFormat,
            iconHTML: "",
            label: getLabelByDateFormat(format),
            accelerator: format === "full" ? formatDateDisplay(Date.now(), format) : undefined,
            click() {
                transaction(options.protyle, [{
                    action: "setAttrViewColDateFormat",
                    id: options.colId,
                    avID: options.avID,
                    format,
                    type: options.type,
                }], [{
                    action: "setAttrViewColDateFormat",
                    id: options.colId,
                    avID: options.avID,
                    format: options.oldFormat,
                    type: options.type,
                }], {
                    callback: () => refreshDatabaseAttributePanels(options.protyle, options.avID),
                });
                options.avPanelElement.remove();
            }
        });
    });
    const rect = options.element.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width, isLeft: true});
};
