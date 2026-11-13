export const bindBacklinkSelection = (element: HTMLElement) => {
    const ownerDocument = element.ownerDocument;
    const clearSelection = (target: Node | null) => {
        element.querySelectorAll('[data-treetype="backlink"].b3-list-item--focus').forEach(item => {
            if (!target || !item.contains(target)) {
                item.classList.remove("b3-list-item--focus");
            }
        });
    };
    const onPointerDown = (event: PointerEvent) => clearSelection(event.target as Node);
    const onFocusIn = (event: FocusEvent) => {
        if (!element.contains(event.target as Node)) {
            clearSelection(null);
        }
    };
    ownerDocument.addEventListener("pointerdown", onPointerDown, true);
    ownerDocument.addEventListener("focusin", onFocusIn, true);
    return () => {
        ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
        ownerDocument.removeEventListener("focusin", onFocusIn, true);
    };
};
