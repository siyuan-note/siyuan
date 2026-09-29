import {isPhablet} from "../util/compatibility";
import {hasClosestBlock, isInEmbedBlock} from "../util/hasClosest";
import {BLOCK_SELECTION_CLASS} from "../wysiwyg/blockSelection";
import {getEmbedGutterOperationContext} from "../wysiwyg/getBlock";
import {isMobile} from "../../util/functions";

// 每个页面只保留当前块选区所属的编辑器，弱引用集合避免保留已关闭的编辑器。
const blockSelectionOwners = new WeakMap<Document, WeakSet<HTMLElement>>();

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
        blockSelectionOwners.get(ownerDocument)?.delete(root);
        return;
    }
    const selection = ownerDocument.getSelection();
    const selected = Array.from(root.querySelectorAll<HTMLElement>(`.${BLOCK_SELECTION_CLASS}`))
        .filter(item => item.closest(".protyle-wysiwyg") === root);
    if (selected.length === 0) {
        blockSelectionOwners.get(ownerDocument)?.delete(root);
    }
    let pointerElement = selection?.focusNode?.nodeType === Node.ELEMENT_NODE ?
        selection.focusNode as Element : selection?.focusNode?.parentElement;
    if (pointerElement && pointerElement.closest(".protyle-wysiwyg") !== root) {
        blockSelectionOwners.get(ownerDocument)?.delete(root);
        return;
    }
    if (!pointerElement) {
        // 在文档末尾外侧结束框选时可能没有文字光标，使用仍然选中的块作为定位目标。
        const target = selectedElement && selected.includes(selectedElement as HTMLElement) ? selectedElement :
            (blockSelectionOwners.get(ownerDocument)?.has(root) ? selected[0] : undefined);
        if (!target) {
            return;
        }
        pointerElement = target;
    }
    let block = hasClosestBlock(pointerElement);
    if (selected.length > 0) {
        // 键盘收起可能清空原生文字选区，后续布局刷新仍可定位到当前有效的块选区。
        blockSelectionOwners.set(ownerDocument, new WeakSet([root]));
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
