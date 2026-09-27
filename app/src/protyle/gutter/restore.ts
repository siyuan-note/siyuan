import {isPhablet} from "../util/compatibility";
import {hasClosestBlock, isInEmbedBlock} from "../util/hasClosest";
import {BLOCK_SELECTION_CLASS} from "../wysiwyg/blockSelection";
import {getEmbedGutterOperationContext} from "../wysiwyg/getBlock";
import {isMobile} from "../../util/functions";

export const restoreGutterBySelection = (protyle: IProtyle, selectedElement?: Element) => {
    const root = protyle.wysiwyg.element;
    const ownerDocument = root.ownerDocument;
    const activeElement = ownerDocument.activeElement;
    // 触屏没有悬停事件，布局稳定后从当前焦点恢复块标，避免其他编辑器抢占块标。
    if ((!isPhablet() && !isMobile()) || !protyle.gutter || !protyle.options.render.gutter ||
        !root.isConnected || root.getClientRects().length === 0 ||
        protyle.toolbar.isMultiSelectMode() || root.classList.contains("fn__pointer-none") ||
        root.classList.contains("protyle-wysiwyg--hiderange") ||
        (activeElement && activeElement !== ownerDocument.body &&
            activeElement.closest(".protyle-wysiwyg") !== root)) {
        return;
    }
    const selection = ownerDocument.getSelection();
    const selected = Array.from(root.querySelectorAll<HTMLElement>(`.${BLOCK_SELECTION_CLASS}`))
        .filter(item => item.closest(".protyle-wysiwyg") === root);
    let pointerElement = selection?.focusNode?.nodeType === Node.ELEMENT_NODE ?
        selection.focusNode as Element : selection?.focusNode?.parentElement;
    if (pointerElement && pointerElement.closest(".protyle-wysiwyg") !== root) {
        return;
    }
    if (!pointerElement) {
        // 在文档末尾外侧结束框选时可能没有文字光标，使用仍然选中的块作为定位目标。
        if (!selectedElement || !selected.includes(selectedElement as HTMLElement)) {
            return;
        }
        pointerElement = selectedElement;
    }
    let block = hasClosestBlock(pointerElement);
    if (selected.length > 0) {
        const rect = protyle.contentElement.getBoundingClientRect();
        const visible = selected.filter(item => {
            const blockRect = item.getBoundingClientRect();
            return item.getClientRects().length > 0 && blockRect.bottom > rect.top && blockRect.top < rect.bottom;
        });
        block = visible.find(item => item.contains(pointerElement)) || visible[0];
    }
    if (!block || !root.contains(block)) {
        return;
    }
    const embed = isInEmbedBlock(block);
    if (embed && !getEmbedGutterOperationContext(block)) {
        block = embed;
    }
    protyle.gutter.render(protyle, block, block.contains(pointerElement) ? pointerElement : block);
};
