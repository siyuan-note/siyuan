export const AV_CELL_EDITOR_CLOSE_EVENT = "siyuan-av-cell-editor-close";

export const closeAVCellEditor = () => {
    document.querySelectorAll(".av__mask:not(.av__richtext-mask)").forEach(element => {
        // 先结束输入法组合输入，再由编辑器提交原单元格的值。
        if (element.contains(document.activeElement)) {
            (document.activeElement as HTMLElement).blur();
        }
        element.dispatchEvent(new CustomEvent(AV_CELL_EDITOR_CLOSE_EVENT));
    });
};
