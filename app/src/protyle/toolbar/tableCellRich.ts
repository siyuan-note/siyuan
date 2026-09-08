import {showMessage} from "../../dialog/message";
import {getTableCellRichInline} from "../util/tableCellRich";
import {TABLE_CELL_RICH_ATTRIBUTE} from "../util/tableCellRichValue";
import {updateTransaction} from "../wysiwyg/transaction";

export const getTableCellRichMenus = (protyle: IProtyle, cells: HTMLTableCellElement[]): IMenu[] => {
    if (protyle.disabled || cells.length !== 1) {
        return [];
    }
    const cell = cells[0];
    const rich = cell.hasAttribute(TABLE_CELL_RICH_ATTRIBUTE);
    const menus: IMenu[] = [{
        id: "tableCellRichEdit",
        icon: "iconEdit",
        label: window.siyuan.languages[rich ? "tableCellRichEdit" : "tableCellRichEnable"],
        click: () => {
            void import("../render/tableCellRichEditor").then(module => module.openTableCellRichEditor(protyle, cell));
        },
    }];
    if (rich) {
        menus.push({
            id: "tableCellRichDisable",
            icon: "iconFont",
            label: window.siyuan.languages.tableCellRichDisable,
            click: () => {
                try {
                    const inline = getTableCellRichInline(cell);
                    const table = cell.closest('[data-type="NodeTable"]');
                    const oldHTML = table.outerHTML;
                    cell.removeAttribute(TABLE_CELL_RICH_ATTRIBUTE);
                    cell.removeAttribute("contenteditable");
                    cell.removeAttribute("tabindex");
                    cell.innerHTML = inline;
                    updateTransaction(protyle, table, oldHTML);
                } catch (error) {
                    console.error(error);
                    showMessage(window.siyuan.languages.tableCellRichInvalid);
                }
            },
        });
    }
    return menus;
};
