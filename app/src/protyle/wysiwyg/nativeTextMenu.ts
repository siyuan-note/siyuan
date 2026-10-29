// 正文使用系统文字菜单，块控件和语义元素仍由各自的菜单处理。
export const usesNativeTextMenu = (target: HTMLElement, editor: HTMLElement) => {
    const editable = target.closest('[contenteditable="true"]');
    const excluded = target.closest(
        "input, textarea, select, button, a, img, audio, video, iframe, [contenteditable='false']:not(.protyle-wysiwyg), " +
        ".protyle-action, .protyle-attr, .av, .protyle-custom, [data-prevent-swipe], " +
        "[data-type~='block-ref'], [data-type~='virtual-block-ref'], [data-type~='file-annotation-ref'], " +
        "[data-type~='a'], [data-type~='tag'], [data-type~='inline-memo'], [data-type~='inline-math']",
    );
    return !!editable && editable.closest(".protyle-wysiwyg") === editor &&
        (!excluded || !editable.contains(excluded));
};

type NativeTextMenuState = {range: Range, timer?: number, requested?: boolean};

const nativeMenus = new WeakMap<HTMLElement, NativeTextMenuState>();

const sameRange = (current: Range, saved: Range) => current && !current.collapsed &&
    current.startContainer === saved.startContainer && current.startOffset === saved.startOffset &&
    current.endContainer === saved.endContainer && current.endOffset === saved.endOffset;

export const isNativeTextSelectionHandleTouch = (event: Event, editor: HTMLElement) => {
    let point: {clientX: number, clientY: number};
    if (event instanceof PointerEvent && event.pointerType === "touch") {
        point = event;
    } else if (event instanceof TouchEvent && event.touches.length === 1) {
        point = event.touches[0];
    } else {
        return false;
    }
    if (event.target instanceof Element && event.target.closest(
        ".protyle-table-control, .protyle-toolbar, .protyle-action, button, a, input, textarea, select")) {
        return false;
    }
    const ownerDocument = editor.ownerDocument;
    const selection = ownerDocument.getSelection();
    const range = selection?.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
    if (!editor.contains(ownerDocument.activeElement) || !range || range.collapsed ||
        !editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
        return false;
    }
    const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
    if (!rects.length) {
        return false;
    }
    const first = rects[0];
    const last = rects[rects.length - 1];
    // 系统手柄位于选区端点外，触摸目标可能是内嵌编辑器之外的单元格留白。
    return Math.hypot(point.clientX - first.left, point.clientY - first.top + 5) <= 20 ||
        Math.hypot(point.clientX - last.right, point.clientY - last.bottom - 5) <= 20;
};

export const cancelNativeTextMenu = (editor: HTMLElement) => {
    const state = nativeMenus.get(editor);
    if (!state) {
        return;
    }
    nativeMenus.delete(editor);
    const ownerWindow = editor.ownerDocument.defaultView;
    if (state.timer !== undefined) {
        ownerWindow.clearTimeout(state.timer);
    }
    if (state.requested) {
        // 空文字只收起本次补显的系统菜单，不改变正文选区。
        void ownerWindow.webkit?.messageHandlers?.showTextMenu?.postMessage("").catch(() => {});
    }
};

export const bindNativeTextMenu = (editor: HTMLElement) => {
    const ownerDocument = editor.ownerDocument;
    const cancel = () => cancelNativeTextMenu(editor);
    const selectionChange = () => {
        const state = nativeMenus.get(editor);
        const selection = ownerDocument.getSelection();
        if (!state) {
            return;
        }
        const range = selection?.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
        if (!editor.contains(ownerDocument.activeElement) || !range || range.collapsed ||
            !editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
            cancel();
        } else if (!sameRange(range, state.range)) {
            if (state.requested && state.timer === undefined) {
                // 系统手柄扩选时沿用新选区，不在拖动过程中关闭文字菜单。
                nativeMenus.set(editor, {range: range.cloneRange(), requested: true});
            } else {
                cancel();
            }
        }
    };
    const pointerDown = (event: Event) => {
        const state = nativeMenus.get(editor);
        const target = event.target;
        if (state?.requested && state.timer === undefined &&
            ((target instanceof Element && target.closest(".protyle-wysiwyg") === editor) ||
                isNativeTextSelectionHandleTouch(event, editor))) {
            return;
        }
        cancel();
    };
    const scroll = (event: Event) => {
        const target = event.target;
        if (target instanceof Node && (editor.contains(target) || target.contains(editor))) {
            cancel();
        }
    };
    const focusOut = (event: FocusEvent) => {
        if (editor.contains(event.target as Node) && !editor.contains(event.relatedTarget as Node)) {
            cancel();
        }
    };
    ownerDocument.addEventListener("selectionchange", selectionChange);
    ownerDocument.addEventListener("scroll", scroll, true);
    ownerDocument.addEventListener("focusout", focusOut, true);
    const pointerEvents = ["pointerdown", "touchstart"];
    pointerEvents.forEach(type => ownerDocument.addEventListener(type, pointerDown, {capture: true, passive: true}));
    ownerDocument.addEventListener("beforeinput", cancel, true);
    return () => {
        cancel();
        ownerDocument.removeEventListener("selectionchange", selectionChange);
        ownerDocument.removeEventListener("scroll", scroll, true);
        ownerDocument.removeEventListener("focusout", focusOut, true);
        pointerEvents.forEach(type => ownerDocument.removeEventListener(type, pointerDown, true));
        ownerDocument.removeEventListener("beforeinput", cancel, true);
    };
};

export const requestNativeTextMenu = (editor: HTMLElement, range: Range) => {
    const ownerDocument = editor.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    const handler = ownerWindow.webkit?.messageHandlers?.showTextMenu;
    if (!handler || range.collapsed) {
        return;
    }
    const previous = nativeMenus.get(editor);
    if (previous?.requested && previous.timer === undefined && sameRange(range, previous.range)) {
        return;
    }
    if (previous?.timer !== undefined) {
        ownerWindow.clearTimeout(previous.timer);
    }
    const saved = range.cloneRange();
    const state: NativeTextMenuState = {range: saved, requested: previous?.requested};
    nativeMenus.set(editor, state);
    // 等待原生双击结束和选区同步，再恢复补选文字的系统菜单。
    state.timer = ownerWindow.setTimeout(() => {
        state.timer = undefined;
        const selection = ownerDocument.getSelection();
        const current = selection?.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
        if (!saved.startContainer.isConnected || !editor.contains(ownerDocument.activeElement) ||
            !sameRange(current, saved)) {
            cancelNativeTextMenu(editor);
            return;
        }
        state.requested = true;
        void handler.postMessage(selection.toString()).then(shown => {
            if (!shown && nativeMenus.get(editor) === state) {
                cancelNativeTextMenu(editor);
            }
        }).catch(() => {
            if (nativeMenus.get(editor) === state) {
                nativeMenus.delete(editor);
            }
        });
    }, 120);
};
