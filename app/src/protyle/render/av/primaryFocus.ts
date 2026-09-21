import {popTextCell} from "./cell";

// 新建条目只在首次完成渲染后进入主键编辑，刷新不重复聚焦，也不覆盖模板内容。
export const focusNewDatabasePrimary = (root: Element, protyle: IProtyle,
                                        request: {avID: string; itemID: string; focusPrimary?: boolean}) => {
    if (!request.focusPrimary || !root.isConnected) {
        return;
    }
    delete request.focusPrimary;
    if (protyle.disabled || window.siyuan.isPublish || protyle.options.history?.created || protyle.options.history?.snapshot) {
        return;
    }
    const field = root.querySelector<HTMLElement>(
        `[data-av-id="${request.avID}"] [data-primary="true"] [data-row-id="${request.itemID}"]`);
    if (field) {
        const input = field.querySelector<HTMLInputElement>("input");
        if (input && !input.disabled && !input.readOnly) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        } else if (!input) {
            popTextCell(protyle, [field], "block");
        }
    }
};
