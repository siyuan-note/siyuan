const editors = new Map<Element, IProtyle>();
let activeEditor: IProtyle;
const undoContexts = new WeakMap<IProtyle, {owner: IProtyle, run: (redo: boolean) => void}>();

export const setMobileToolbarUndo = (protyle: IProtyle, owner: IProtyle, run: (redo: boolean) => void) => {
    undoContexts.set(protyle, {owner, run});
};

export const getMobileToolbarUndo = (protyle: IProtyle) => undoContexts.get(protyle);

export const getMobileToolbarPaddingElement = (protyle: IProtyle) => {
    // 单元格的键盘占位放在所属编辑器上，避免撑高表格行。
    const owner = undoContexts.get(protyle)?.owner || protyle;
    return owner.lite ? owner.contentElement : owner.element.parentElement;
};

export const getMobileToolbarProtyle = () => {
    const root = document.activeElement?.closest(".protyle-wysiwyg");
    if (root) {
        activeEditor = editors.get(root);
    }
    if (activeEditor && (!activeEditor.element.isConnected || activeEditor.element.closest("[inert]"))) {
        activeEditor = undefined;
    }
    return activeEditor;
};

export const bindMobileToolbar = (protyle: IProtyle) => {
    const element = protyle.wysiwyg.element;
    editors.set(element, protyle);
    const activate = (event: Event) => {
        if ((event.target as Element).closest(".protyle-wysiwyg") !== element || activeEditor === protyle) {
            return;
        }
        const previous = activeEditor;
        activeEditor = protyle;
        // 共享工具栏切换编辑上下文，保留各编辑器自己的选区和撤销栈。
        window.dispatchEvent(new CustomEvent("siyuan-mobile-toolbar-editor", {detail: previous}));
    };
    element.addEventListener("focusin", activate);
    element.addEventListener("pointerdown", activate);
    return () => {
        element.removeEventListener("focusin", activate);
        element.removeEventListener("pointerdown", activate);
        editors.delete(element);
        if (activeEditor === protyle) {
            activeEditor = undefined;
            window.dispatchEvent(new CustomEvent("siyuan-mobile-toolbar-editor", {detail: protyle}));
        }
    };
};
