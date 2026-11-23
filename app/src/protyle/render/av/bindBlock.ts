import {hintRef} from "../../hint/extend";
import {getStoredCellValueByElement} from "./cellValue";

export const openAVBindBlock = (protyle: IProtyle, field: HTMLElement, query?: string) => {
    if (!field.isConnected || !field.dataset.rowId || protyle.disabled || window.siyuan.isPublish ||
        protyle.options.history?.created || protyle.options.history?.snapshot) {
        return;
    }
    window.siyuan.menus.menu.remove();
    protyle.toolbar.range = document.createRange();
    protyle.toolbar.range.selectNodeContents(field);
    hintRef(query ?? getStoredCellValueByElement(field)?.block?.content?.trim() ?? "", protyle, "av");
    return true;
};
