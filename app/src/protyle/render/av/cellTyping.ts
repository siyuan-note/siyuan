import {Constants} from "../../../constants";
import {focusBlock} from "../../util/selection";
import {addDragFill, hasAVPrimaryTemplate, popTextCell} from "./cell";
import {setAVCellAnchor} from "./rangeSelect";
import {getAVCellSelection} from "./selectionState";
import {isTableLikeView} from "./viewType";

export const selectNewAVPrimary = (protyle: IProtyle, block: HTMLElement, cell: HTMLElement) => {
    if (protyle.disabled || window.siyuan.config.readonly || window.siyuan.isPublish ||
        protyle.options.history?.created || protyle.options.history?.snapshot || !focusBlock(block)) {
        return;
    }
    if (setAVCellAnchor(block, cell)) {
        addDragFill(cell);
    }
};

export const bindAVCellTyping = (protyle: IProtyle, editor: HTMLElement) => {
    const doc = editor.ownerDocument;
    const getTarget = (event: Event) => {
        const anchor = doc.getSelection()?.anchorNode;
        const element = anchor instanceof Element ? anchor : anchor?.parentElement;
        const cursor = element?.closest<HTMLElement>(".av__cursor");
        const block = cursor?.closest<HTMLElement>(".av");
        if (!block || !editor.contains(cursor) || !isTableLikeView(block.dataset.avType) ||
            (doc.activeElement !== editor && doc.activeElement !== cursor) ||
            (event.target !== editor && event.target !== cursor) || protyle.disabled ||
            window.siyuan.config.readonly || window.siyuan.isPublish || protyle.options.history?.created ||
            protyle.options.history?.snapshot || getAVCellSelection(block)?.cells.length > 1 ||
            !window.siyuan.menus.menu.element.classList.contains("fn__none") ||
            doc.querySelector(".av__mask, .av__panel, [data-av-location-editor]")) {
            return;
        }
        const cell = block.querySelector<HTMLElement>(".av__cell--select");
        if (cell?.closest(".av") === block &&
            (cell.dataset.dtype === "text" || cell.dataset.dtype === "block" && !hasAVPrimaryTemplate(cell))) {
            return {block, cell, cursor};
        }
    };

    // 输入法在数据库光标内完成组字，提交时才打开编辑器，避免切换焦点中断候选选择。
    let composing: ReturnType<typeof getTarget>;
    let releaseAnchor = () => {};
    const clearAnchor = () => {
        releaseAnchor();
        releaseAnchor = () => {};
    };
    const isDatabaseInput = (event: Event) => {
        if (composing && !editor.contains(composing.cursor)) {
            clearAnchor();
            composing = undefined;
        }
        return composing && (event.target === editor || event.target === composing.cursor);
    };
    editor.addEventListener("compositionstart", event => {
        clearAnchor();
        composing = getTarget(event);
        if (!composing) return;
        const {cell, cursor} = composing;
        const {translate, whiteSpace, width} = cursor.style;
        // 保留当前编辑节点和选区，将候选窗定位到选中单元格，避免打断输入法组字。
        if (!translate && cursor.firstChild) {
            const caret = doc.createRange();
            caret.setStart(cursor.firstChild, 0);
            caret.collapse(true);
            const caretRect = caret.getBoundingClientRect();
            const cellRect = cell.getBoundingClientRect();
            if (caretRect.height > 0 && cellRect.width > 0 && cellRect.height > 0) {
                const content = cell.querySelector(".av__celltext")?.getBoundingClientRect();
                const x = Math.min(cellRect.right, Math.max(cellRect.left, content?.left ?? cellRect.left));
                const y = cellRect.top + (cellRect.height - caretRect.height) / 2;
                cursor.style.translate = `${x - caretRect.left}px ${y - caretRect.top}px`;
                // 输入法按组字文本的末尾定位候选窗，因此组字期间不允许隐藏光标内的文本换行。
                cursor.style.whiteSpace = "nowrap";
                cursor.style.width = "auto";
                releaseAnchor = () => { Object.assign(cursor.style, {translate, whiteSpace, width}); };
            }
        }
        event.stopImmediatePropagation();
    }, true);
    editor.addEventListener("beforeinput", (event: InputEvent) => {
        if (isDatabaseInput(event)) {
            event.stopImmediatePropagation();
        } else if (event.inputType === "insertText" && event.data && event.cancelable) {
            const target = getTarget(event);
            if (target) {
                event.preventDefault();
                event.stopImmediatePropagation();
                queueMicrotask(() => {
                    if (getTarget(event)?.cell === target.cell) {
                        popTextCell(protyle, [target.cell], undefined, {initialInput: event.data});
                    }
                });
            }
        }
    }, true);
    const keepDatabaseInput = (event: Event) => {
        if (isDatabaseInput(event)) event.stopImmediatePropagation();
    };
    editor.addEventListener("input", keepDatabaseInput, true);
    editor.addEventListener("keydown", keepDatabaseInput, true);
    editor.addEventListener("keyup", keepDatabaseInput, true);
    editor.addEventListener("focusout", event => {
        if (isDatabaseInput(event) && event.relatedTarget !== editor && event.relatedTarget !== composing.cursor) {
            clearAnchor();
            composing.cursor.textContent = Constants.ZWSP;
            composing = undefined;
        }
    }, true);
    editor.addEventListener("compositionend", event => {
        if (!isDatabaseInput(event)) return;
        const {block, cell, cursor} = composing;
        event.stopImmediatePropagation();
        queueMicrotask(() => {
            composing = undefined;
            const isCurrent = getTarget(event)?.cell === cell;
            clearAnchor();
            cursor.textContent = Constants.ZWSP;
            if (isCurrent && event.data) {
                popTextCell(protyle, [cell], undefined, {initialInput: event.data});
            } else if (isCurrent) {
                focusBlock(block);
            }
        });
    }, true);
};
