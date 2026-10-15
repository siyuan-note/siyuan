export const AV_CELL_EDITOR_CLOSE_EVENT = "siyuan-av-cell-editor-close";

export const getAVCellEditorOwner = (blockElement: HTMLElement) =>
    blockElement.closest<HTMLElement>(".protyle-db-row, .b3-dialog__container, .custom-attr") || blockElement;

export const closeAVCellEditor = (owner?: HTMLElement, save = true) => {
    document.querySelectorAll<HTMLElement>(save ? ".av__mask:not(.av__richtext-mask), [data-av-location-editor]" :
        ".av__mask, [data-av-location-editor]").forEach(element => {
        if (owner && !Array.from(owner.querySelectorAll<HTMLElement>("[data-node-id]"))
            .some(block => block.dataset.nodeId === element.dataset.avBlockId)) {
            return;
        }
        if (element.dataset.avLocationEditor === "true") {
            // 位置对话框只允许显式保存，导航、锁定与父面板关闭均取消未提交的输入。
            element.dispatchEvent(new CustomEvent(AV_CELL_EDITOR_CLOSE_EVENT));
            return;
        }
        if (!save) {
            // 锁定或删除所属内容时立即清除浮层，不再向已失效的目标提交草稿。
            element.remove();
            return;
        }
        // 先结束输入法组合输入，再由编辑器提交原单元格的值。
        if (element.contains(document.activeElement)) {
            (document.activeElement as HTMLElement).blur();
        }
        element.dispatchEvent(new CustomEvent(AV_CELL_EDITOR_CLOSE_EVENT));
    });
};
