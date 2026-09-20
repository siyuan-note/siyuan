const restoredFocusHandlers = new WeakMap<HTMLElement, () => void>();

export const recordRestoredSpellcheckFocus = (element: HTMLElement, previousActiveElement: Element | null) => {
    // 只记录文档恢复时新获得的正文焦点，已聚焦编辑器中的选区更新不重新触发。
    if (previousActiveElement !== element && element.ownerDocument.activeElement === element) {
        restoredFocusHandlers.get(element)?.();
    }
};

export const bindSpellcheckFocus = (element: HTMLElement, isEnabled: () => boolean) => {
    const doc = element.ownerDocument;
    const view = doc.defaultView;
    let pending = false;
    let composing = false;
    let mousePointer = false;
    let candidate: MouseEvent | undefined;
    const clear = () => {
        pending = false;
        candidate = undefined;
    };
    const canRefresh = () => pending && !composing && isEnabled() && element.isConnected &&
        element.isContentEditable && element.spellcheck && doc.activeElement === element;
    const hasCollapsedSelection = () => {
        const selection = doc.getSelection();
        return selection?.rangeCount === 1 && selection.isCollapsed && element.contains(selection.anchorNode);
    };
    const onPointerDown = (event: PointerEvent) => {
        mousePointer = !composing && event.isPrimary && event.pointerType === "mouse";
    };
    const onMouseDown = (event: MouseEvent) => {
        candidate = undefined;
        if (!canRefresh() || !mousePointer || !event.isTrusted || event.defaultPrevented || event.button !== 0 ||
            event.detail !== 1 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey ||
            !hasCollapsedSelection()) {
            return;
        }
        const target = event.target as HTMLElement;
        const block = target.closest('[data-type="NodeParagraph"]');
        if (block?.parentElement !== element || !target.isContentEditable || !target.spellcheck ||
            !target.closest('[contenteditable="true"]')?.parentElement?.isSameNode(block) ||
            target.closest('a, button, input, textarea, select, [draggable="true"], [contenteditable="false"], ' +
                '[data-type~="a"], [data-type~="block-ref"], [data-type~="file-annotation-ref"], ' +
                '[data-type~="tag"], .img, .render-node, .protyle-attr') ||
            element.querySelector(".protyle-wysiwyg--select")) {
            return;
        }
        candidate = event;
    };
    const onWindowMouseDown = (event: MouseEvent) => {
        if (candidate !== event) {
            return;
        }
        candidate = undefined;
        if (event.defaultPrevented || !canRefresh() || !hasCollapsedSelection()) {
            return;
        }
        // 等编辑器及祖先的鼠标处理结束后释放焦点，由这次真实点击的默认行为重新聚焦。
        // 不调用 focus 或修改选区，保留浏览器的点击定位和拖选行为。
        clear();
        element.blur();
    };
    const onCompositionStart = () => {
        composing = true;
        candidate = undefined;
    };
    const onCompositionEnd = () => {
        composing = false;
    };
    restoredFocusHandlers.set(element, () => {
        pending = isEnabled();
    });
    element.addEventListener("pointerdown", onPointerDown, true);
    element.addEventListener("mousedown", onMouseDown, true);
    element.addEventListener("focusout", clear);
    element.addEventListener("compositionstart", onCompositionStart, true);
    element.addEventListener("compositionend", onCompositionEnd, true);
    view.addEventListener("mousedown", onWindowMouseDown);
    return () => {
        clear();
        restoredFocusHandlers.delete(element);
        element.removeEventListener("pointerdown", onPointerDown, true);
        element.removeEventListener("mousedown", onMouseDown, true);
        element.removeEventListener("focusout", clear);
        element.removeEventListener("compositionstart", onCompositionStart, true);
        element.removeEventListener("compositionend", onCompositionEnd, true);
        view.removeEventListener("mousedown", onWindowMouseDown);
    };
};
