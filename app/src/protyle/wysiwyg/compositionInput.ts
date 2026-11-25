// 只将明确提交的文本输入作为恢复信号，避免提前结束仍在更新的输入法候选内容。
export const isCommittedTextInput = (event: Pick<InputEvent, "isComposing" | "inputType">) => {
    return event.isComposing === false &&
        ["insertText", "insertReplacementText", "insertFromComposition"].includes(event.inputType);
};

const formulaAtBoundary = (container: Node, offset: number, beforeFormula: boolean) => {
    const isPlaceholder = (text: string) => /^[\u200b\ufeff]*$/.test(text);
    let candidate: Node;
    if (container.nodeType === Node.TEXT_NODE) {
        const text = container as Text;
        if (!isPlaceholder(beforeFormula ? text.data.slice(offset) : text.data.slice(0, offset))) {
            return;
        }
        candidate = beforeFormula ? container.nextSibling : container.previousSibling;
    } else {
        candidate = container.childNodes[beforeFormula ? offset : offset - 1];
    }
    while (candidate?.nodeType === Node.TEXT_NODE && isPlaceholder(candidate.textContent)) {
        candidate = beforeFormula ? candidate.nextSibling : candidate.previousSibling;
    }
    if (candidate instanceof HTMLElement && candidate.matches('span[data-type~="inline-math"][contenteditable="false"]')) {
        return candidate;
    }
};

export const prepareInlineMathComposition = (range: Range) => {
    if (range.collapsed) {
        return;
    }
    const formula = formulaAtBoundary(range.startContainer, range.startOffset, true);
    if (!formula || formula !== formulaAtBoundary(range.endContainer, range.endOffset, false)) {
        return;
    }
    const parent = formula.parentElement;
    const selection = formula.ownerDocument.getSelection();
    if (!selection?.rangeCount || selection.getRangeAt(0) !== range) {
        return;
    }
    const backward = selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset;
    const start = formula.ownerDocument.createTextNode("\u200b");
    const end = formula.ownerDocument.createTextNode("\u200b");
    formula.before(start);
    formula.after(end);
    const position = formula.ownerDocument.createRange();
    position.setStartBefore(start);
    position.collapse(true);
    // 公式的渲染节点不可编辑，组合输入需要从公式两侧的可编辑文本开始和结束。
    if (backward) {
        selection.setBaseAndExtent(end, end.length, start, 0);
    } else {
        selection.setBaseAndExtent(start, 0, end, end.length);
    }

    return (committed: boolean, restoreSelection = false) => {
        for (const marker of [start, end]) {
            if (marker.data === "\u200b") {
                marker.remove();
            }
        }
        if (committed || !parent.isConnected || !parent.contains(position.startContainer)) {
            return false;
        }
        if (!formula.parentNode) {
            position.insertNode(formula);
        }
        if (restoreSelection && selection.anchorNode && parent.contains(selection.anchorNode)) {
            position.selectNode(formula);
            selection.setBaseAndExtent(parent, backward ? position.endOffset : position.startOffset,
                parent, backward ? position.startOffset : position.endOffset);
        }
        return true;
    };
};
