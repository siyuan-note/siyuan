let editor: HTMLElement;
let selecting = false;
let touching = false;
let gestureUntil = 0;
const inputModes = new Map<Element, string | null>();

const suppressInput = (element: Element) => {
    if (!inputModes.has(element)) {
        inputModes.set(element, element.getAttribute("inputmode"));
    }
    element.setAttribute("inputmode", "none");
};

export const clearMobileSelectionInput = () => {
    inputModes.forEach((value, element) => {
        if (value === null) {
            element.removeAttribute("inputmode");
        } else {
            element.setAttribute("inputmode", value);
        }
    });
    inputModes.clear();
    editor = undefined;
    selecting = false;
    touching = false;
    gestureUntil = 0;
};

export const isMobileSelectionMode = () => {
    if (editor && !editor.isConnected) {
        clearMobileSelectionInput();
    }
    return selecting;
};

export const suppressMobileSelectionFocus = (element: Element) => {
    if (editor && element && !editor.contains(element) && !element.closest("#keyboardToolbar, .protyle-util, .b3-menu")) {
        clearMobileSelectionInput();
        return false;
    }
    if (!editor?.isConnected || !editor.contains(element) || (!selecting && inputModes.size === 0)) {
        return false;
    }
    // 格式操作可能替换可编辑节点，恢复焦点时继续保留选择模式。
    suppressInput(element);
    return true;
};

export const getMobileSelectionRange = () => {
    if (!isMobileSelectionMode()) {
        return;
    }
    const selection = getSelection();
    if (!selection?.rangeCount) {
        return;
    }
    const range = selection.getRangeAt(0);
    if (!range.collapsed && editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
        return range;
    }
};

const refreshSelectionFocus = () => {
    const active = document.activeElement as HTMLElement;
    const selection = getSelection();
    if (window.JSAndroid || window.JSHarmony || !getMobileSelectionRange() || !editor.contains(active)) {
        return;
    }
    // 浏览器在焦点切换时应用 inputmode，保留方向及端点，避免收起键盘时丢失选区。
    const {anchorNode, anchorOffset, focusNode, focusOffset} = selection;
    suppressInput(active);
    active.blur();
    active.focus({preventScroll: true});
    selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
};

export const initMobileSelectionInput = (onSelect: () => void, onChange: () => void) => {
    const begin = (event: PointerEvent) => {
        if (event.pointerType !== "touch" && event.pointerType !== "pen") {
            return;
        }
        const target = event.target as HTMLElement;
        if (target.closest("#keyboardToolbar, .protyle-util, .b3-menu")) {
            return;
        }
        const root = target.closest<HTMLElement>('.protyle-wysiwyg[data-readonly="false"]');
        const editable = target.closest<HTMLElement>('[contenteditable="true"], [contenteditable="plaintext-only"]');
        if (!root || !editable || target.closest("input, textarea") ||
            target.closest("[contenteditable]")?.getAttribute("contenteditable") === "false" ||
            root.querySelector(".protyle-wysiwyg--select")) {
            clearMobileSelectionInput();
            return;
        }
        if (editor !== root) {
            clearMobileSelectionInput();
        }
        editor = root;
        touching = true;
        // 在浏览器处理长按之前阻止首次唤起键盘；短按会在 click 中恢复输入。
        if (selecting || !document.body.classList.contains("mobile-keyboard--open")) {
            suppressInput(editable);
        }
    };
    const end = () => {
        touching = false;
        gestureUntil = Date.now() + 600;
        refreshSelectionFocus();
    };
    const update = () => {
        if (!editor?.isConnected || (!selecting && !touching && Date.now() > gestureUntil)) {
            return;
        }
        const selection = getSelection();
        if (!selection?.rangeCount || selection.isCollapsed || !editor.contains(selection.anchorNode) ||
            !editor.contains(selection.focusNode)) {
            onChange();
            return;
        }
        const wasSelecting = selecting;
        selecting = true;
        [selection.anchorNode, selection.focusNode].forEach(node => {
            const element = (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)
                ?.closest<HTMLElement>('[contenteditable="true"], [contenteditable="plaintext-only"]');
            if (element) {
                suppressInput(element);
            }
        });
        if (!wasSelecting) {
            onSelect();
            if (!touching) {
                refreshSelectionFocus();
            }
        }
        onChange();
    };
    const click = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!editor?.contains(target)) {
            return;
        }
        update();
        if (getMobileSelectionRange()) {
            return;
        }
        const editable = target.closest<HTMLElement>('[contenteditable="true"], [contenteditable="plaintext-only"]');
        const restoreInput = inputModes.size > 0;
        const selection = getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
        clearMobileSelectionInput();
        if (restoreInput && editable && range) {
            editable.blur();
            editable.focus({preventScroll: true});
            selection.removeAllRanges();
            selection.addRange(range);
        }
    };
    document.addEventListener("pointerdown", begin, true);
    document.addEventListener("pointerup", end, true);
    document.addEventListener("pointercancel", end, true);
    document.addEventListener("selectionchange", update, true);
    document.addEventListener("click", click, true);
    document.addEventListener("contextmenu", event => {
        update();
        if (getMobileSelectionRange() && editor.contains(event.target as Node)) {
            event.preventDefault();
            event.stopPropagation();
            onChange();
        }
    }, true);
    document.addEventListener("focusin", event => {
        const target = event.target as HTMLElement;
        if (target.matches("input, textarea") && !target.closest("#keyboardToolbar")) {
            clearMobileSelectionInput();
        }
    }, true);
};
