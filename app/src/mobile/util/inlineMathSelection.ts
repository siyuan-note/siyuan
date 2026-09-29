export const createInlineMathSelection = () => {
    let previousRange: Range;
    let previousEditor: HTMLElement;

    const reset = () => {
        previousRange = undefined;
        previousEditor = undefined;
    };

    const normalize = (editor: HTMLElement, selection: Selection, composing = false) => {
        if (!editor || composing || !selection?.isCollapsed || selection.rangeCount !== 1 ||
            !editor.contains(selection.anchorNode)) {
            reset();
            return false;
        }
        if (previousEditor !== editor) {
            reset();
        }
        const range = selection.getRangeAt(0);
        const element = range.startContainer.nodeType === 1 ? range.startContainer as Element :
            range.startContainer.parentElement;
        const math = element?.closest('[data-type~="inline-math"]');
        if (!math || !editor.contains(math)) {
            previousRange = range.cloneRange();
            previousEditor = editor;
            return false;
        }
        const parent = math.parentElement;
        if (!parent.isContentEditable) {
            reset();
            return false;
        }
        let after = true;
        if (previousRange?.startContainer.isConnected && editor.contains(previousRange.startContainer)) {
            const beforeMath = range.cloneRange();
            beforeMath.setStartBefore(math);
            beforeMath.collapse(true);
            after = previousRange.compareBoundaryPoints(Range.START_TO_START, beforeMath) <= 0;
        }
        const boundary = range.cloneRange();
        const sibling = after ? math.nextSibling : math.previousSibling;
        // 优先落在公式外的文本节点，避免输入法继续把插入点映射到公式内部。
        if (sibling?.nodeType === 3) {
            boundary.setStart(sibling, after ? 0 : sibling.textContent.length);
        } else if (after) {
            boundary.setStartAfter(math);
        } else {
            boundary.setStartBefore(math);
        }
        boundary.collapse(true);
        selection.setBaseAndExtent(boundary.startContainer, boundary.startOffset,
            boundary.startContainer, boundary.startOffset);
        previousRange = boundary.cloneRange();
        previousEditor = editor;
        return true;
    };

    const update = (editor: HTMLElement, selection: Selection, composing = false) => {
        const element = selection?.anchorNode?.nodeType === 1 ? selection.anchorNode as Element :
            selection?.anchorNode?.parentElement;
        if (previousEditor !== editor) {
            reset();
        }
        // 原生光标手柄经过公式时保留选区，仅在输入前校正边界，避免中断拖动或误打开公式编辑。
        if (!editor || composing || selection?.rangeCount !== 1 || !selection.isCollapsed || !editor.contains(element) ||
            !element?.closest('[data-type~="inline-math"]')) {
            normalize(editor, selection, composing);
        }
    };

    const prepareInput = (editor: HTMLElement, selection: Selection) => {
        if (!editor || selection?.rangeCount !== 1) {
            reset();
            return false;
        }
        if (selection.isCollapsed) {
            return normalize(editor, selection);
        }
        const range = selection.getRangeAt(0).cloneRange();
        if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
            return false;
        }
        const getMath = (node: Node) => {
            const element = node.nodeType === 1 ? node as Element : node.parentElement;
            const math = element?.closest('[data-type~="inline-math"]');
            return math && editor.contains(math) && math.parentElement.isContentEditable ? math : undefined;
        };
        const startMath = getMath(range.startContainer);
        const endMath = getMath(range.endContainer);
        if (!startMath && !endMath) {
            return false;
        }
        // 输入和删除按完整公式处理，避免修改 KaTeX 的内部渲染节点。
        const backward = selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset;
        if (startMath) {
            range.setStartBefore(startMath);
        }
        if (endMath) {
            range.setEndAfter(endMath);
        }
        selection.setBaseAndExtent(backward ? range.endContainer : range.startContainer,
            backward ? range.endOffset : range.startOffset,
            backward ? range.startContainer : range.endContainer,
            backward ? range.startOffset : range.endOffset);
        reset();
        return true;
    };

    return {normalize, reset, update, prepareInput};
};
