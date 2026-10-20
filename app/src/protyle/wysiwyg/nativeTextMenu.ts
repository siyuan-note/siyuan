// 正文使用系统文字菜单，块控件和语义元素仍由各自的菜单处理。
export const usesNativeTextMenu = (target: HTMLElement, editor: HTMLElement) => {
    const editable = target.closest('[contenteditable="true"]');
    return !!editable && editor.contains(editable) && !target.closest(
        "input, textarea, button, a, img, audio, video, iframe, [contenteditable='false']:not(.protyle-wysiwyg), " +
        ".protyle-action, .protyle-attr, .table, .av, .protyle-custom, [data-prevent-swipe], " +
        "[data-type~='block-ref'], [data-type~='virtual-block-ref'], [data-type~='file-annotation-ref'], " +
        "[data-type~='a'], [data-type~='tag'], [data-type~='inline-memo'], [data-type~='inline-math']",
    );
};

type NativeTextMenuState = {range: Range, timer?: number, requested?: boolean};

const nativeMenus = new WeakMap<HTMLElement, NativeTextMenuState>();

const sameRange = (current: Range, saved: Range) => current && !current.collapsed &&
    current.startContainer === saved.startContainer && current.startOffset === saved.startOffset &&
    current.endContainer === saved.endContainer && current.endOffset === saved.endOffset;

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
        if (state && (!editor.contains(ownerDocument.activeElement) || !selection?.rangeCount ||
            !sameRange(selection.getRangeAt(0), state.range))) {
            cancel();
        }
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
    const cancelEvents = ["pointerdown", "touchstart", "beforeinput"];
    cancelEvents.forEach(type => ownerDocument.addEventListener(type, cancel, {capture: true, passive: true}));
    return () => {
        cancel();
        ownerDocument.removeEventListener("selectionchange", selectionChange);
        ownerDocument.removeEventListener("scroll", scroll, true);
        ownerDocument.removeEventListener("focusout", focusOut, true);
        cancelEvents.forEach(type => ownerDocument.removeEventListener(type, cancel, true));
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
