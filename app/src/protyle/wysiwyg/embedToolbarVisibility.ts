const EMBED_SELECTOR = '[data-type="NodeBlockQueryEmbed"]';
const HIDDEN_CLASS = "protyle-icons--editing-obscured";
const PROXIMITY = 12;

const getToolbar = (element: Element | null): HTMLElement | null => {
    const embed = element?.closest(EMBED_SELECTOR);
    return embed?.querySelector<HTMLElement>(":scope > .protyle-icons") || null;
};

const isNearToolbar = (rect: DOMRect, toolbar: HTMLElement): boolean => {
    const toolbarRect = toolbar.getBoundingClientRect();
    return rect.right >= toolbarRect.left - PROXIMITY && rect.left <= toolbarRect.right + PROXIMITY &&
        rect.bottom >= toolbarRect.top - PROXIMITY && rect.top <= toolbarRect.bottom + PROXIMITY;
};

export const bindEmbedToolbarVisibility = (root: HTMLElement): (() => void) => {
    let caretToolbar: HTMLElement | null = null;

    const onSelectionChange = () => {
        const previous = caretToolbar;
        caretToolbar = null;
        const selection = document.getSelection();
        if (selection?.rangeCount && selection.focusNode && root.contains(selection.focusNode) &&
            root.contains(document.activeElement)) {
            const focusElement = selection.focusNode.nodeType === Node.ELEMENT_NODE ?
                selection.focusNode as Element : selection.focusNode.parentElement;
            if (focusElement?.closest(".protyle-wysiwyg__embed")) {
                const toolbar = getToolbar(focusElement);
                if (toolbar) {
                    const range = document.createRange();
                    range.setStart(selection.focusNode, selection.focusOffset);
                    range.collapse(true);
                    const rect = range.getClientRects()[0] || range.getBoundingClientRect();
                    if (isNearToolbar(rect, toolbar)) {
                        caretToolbar = toolbar;
                    }
                }
            }
        }
        if (previous !== caretToolbar) {
            previous?.classList.remove(HIDDEN_CLASS);
            caretToolbar?.classList.add(HIDDEN_CLASS);
        }
    };

    const onFocusOut = () => queueMicrotask(onSelectionChange);

    document.addEventListener("selectionchange", onSelectionChange);
    root.addEventListener("focusout", onFocusOut);
    return () => {
        document.removeEventListener("selectionchange", onSelectionChange);
        root.removeEventListener("focusout", onFocusOut);
        caretToolbar?.classList.remove(HIDDEN_CLASS);
    };
};
