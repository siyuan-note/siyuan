interface IRememberedBoundary {
    node: Node;
    value: string | null;
    before?: ChildNode;
    after?: ChildNode;
}

interface IRememberedRange {
    range: Range;
    start: IRememberedBoundary;
    end: IRememberedBoundary;
}

const rememberBoundary = (node: Node, offset: number): IRememberedBoundary => ({
    node, value: node.nodeValue, before: node.childNodes[offset - 1], after: node.childNodes[offset],
});

const isBoundaryAvailable = (saved: IRememberedBoundary, node: Node, offset: number) =>
    saved.node === node && node.isConnected && saved.value === node.nodeValue &&
    saved.before === node.childNodes[offset - 1] && saved.after === node.childNodes[offset];

const editors = new WeakSet<HTMLElement>();
const documents = new WeakSet<Document>();
const ranges = new WeakMap<HTMLElement, IRememberedRange>();

export const rememberEditorFocusRange = (element: HTMLElement, range: Range) => {
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
        return;
    }
    ranges.set(element, {
        range: range.cloneRange(),
        start: rememberBoundary(range.startContainer, range.startOffset),
        end: rememberBoundary(range.endContainer, range.endOffset),
    });
};

export const getRememberedEditorFocusRange = (element: HTMLElement) => {
    const saved = ranges.get(element);
    // DOM 重建后浏览器会把 Range 移到父节点，不能将该位置当作原插入位置。
    if (!saved || !isBoundaryAvailable(saved.start, saved.range.startContainer, saved.range.startOffset) ||
        !isBoundaryAvailable(saved.end, saved.range.endContainer, saved.range.endOffset) ||
        !element.contains(saved.start.node) || !element.contains(saved.end.node)) {
        ranges.delete(element);
        return undefined;
    }
    return saved.range.cloneRange();
};

export const bindEditorFocusMemory = (element: HTMLElement) => {
    editors.add(element);
    const ownerDocument = element.ownerDocument;
    if (!documents.has(ownerDocument)) {
        documents.add(ownerDocument);
        const remember = () => {
            const selection = ownerDocument.getSelection();
            if (!selection?.rangeCount) {
                return;
            }
            const range = selection.getRangeAt(0);
            const node = range.startContainer;
            const root = (node.nodeType === 1 ? node as Element : node.parentElement)
                ?.closest<HTMLElement>(".protyle-wysiwyg");
            if (root && editors.has(root)) {
                rememberEditorFocusRange(root, range);
            }
        };
        ownerDocument.addEventListener("selectionchange", remember);
        // 在外部按钮、输入框或触摸操作改变浏览器选区前保存正文位置。
        ownerDocument.addEventListener("pointerdown", remember, true);
        ownerDocument.addEventListener("focusout", remember, true);
    }
    return () => {
        editors.delete(element);
        ranges.delete(element);
    };
};
