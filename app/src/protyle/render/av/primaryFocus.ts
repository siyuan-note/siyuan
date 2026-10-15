import {popTextCell} from "./cell";
import {openAVBindBlock} from "./bindBlock";

// 打开条目后只在首次完成渲染时进入主键编辑，刷新不重复聚焦，也不覆盖现有内容。
export const focusDatabasePrimary = (root: Element, protyle: IProtyle,
                                        request: {avID: string; itemID: string; focusPrimary?: boolean; bindPrimary?: boolean}) => {
    if ((!request.focusPrimary && !request.bindPrimary) || !root.isConnected) {
        return;
    }
    delete request.focusPrimary;
    const bindPrimary = request.bindPrimary;
    delete request.bindPrimary;
    if (protyle.disabled || window.siyuan.isPublish || protyle.options.history?.created || protyle.options.history?.snapshot) {
        return;
    }
    const field = root.querySelector<HTMLElement>(
        `[data-av-id="${request.avID}"] [data-primary="true"] [data-row-id="${request.itemID}"]`);
    if (field) {
        if (bindPrimary) {
            openAVBindBlock(protyle, field);
            return;
        }
        const input = field.querySelector<HTMLInputElement>("input");
        if (input && !input.disabled && !input.readOnly) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        } else if (!input) {
            popTextCell(protyle, [field], "block");
        }
    }
};
