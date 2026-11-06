export const AV_CELL_EDITOR_CLOSE_EVENT = "siyuan-av-cell-editor-close";

export const getAVCellEditorOwner = (blockElement: HTMLElement) =>
    blockElement.closest<HTMLElement>(".protyle-db-row, .b3-dialog__container, .custom-attr") || blockElement;

export const closeAVCellEditor = (owner?: HTMLElement, save = true) => {
    const menu = typeof window !== "undefined" && window.siyuan?.menus?.menu;
    if (!save && owner && menu && menu.data instanceof HTMLElement && owner.contains(menu.data)) {
        menu.remove();
    }
    document.querySelectorAll<HTMLElement>(save ? ".av__mask:not(.av__richtext-mask), [data-av-location-editor]" :
        ".av__mask, [data-av-location-editor], [data-av-richtext-editor], .av__panel").forEach(element => {
        if (owner && !Array.from(owner.querySelectorAll<HTMLElement>("[data-node-id], [data-av-host]"))
            .some(block => (block.dataset.avHost || block.dataset.nodeId) === element.dataset.avBlockId)) {
            return;
        }
        if (element.dataset.avLocationEditor === "true" || element.dataset.avRichtextEditor === "true") {
            // 对话框通过取消事件释放会话和输入资源，失效关闭不能提交草稿。
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
