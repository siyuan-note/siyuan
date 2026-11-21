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
    const isDatabaseInput = (event: Event) => {
        if (composing && !editor.contains(composing.cursor)) composing = undefined;
        return composing && (event.target === editor || event.target === composing.cursor);
    };
    editor.addEventListener("compositionstart", event => {
        composing = getTarget(event);
        if (composing) event.stopImmediatePropagation();
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
            cursor.textContent = Constants.ZWSP;
            if (isCurrent && event.data) {
                popTextCell(protyle, [cell], undefined, {initialInput: event.data});
            } else if (isCurrent) {
                focusBlock(block);
            }
        });
    }, true);
};
