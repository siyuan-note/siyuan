import {hintRef} from "../../hint/extend";

export const openAVBindBlock = (protyle: IProtyle, field: HTMLElement) => {
    if (!field.isConnected || !field.dataset.rowId || protyle.disabled || window.siyuan.isPublish ||
        protyle.options.history?.created || protyle.options.history?.snapshot) {
        return;
    }
    window.siyuan.menus.menu.remove();
    protyle.toolbar.range = document.createRange();
    protyle.toolbar.range.selectNodeContents(field);
    hintRef(field.querySelector("input")?.value.trim() || "", protyle, "av");
};
