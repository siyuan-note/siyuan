import type {Protyle} from "../../protyle";
import {registerEditorSave} from "../../protyle/util/editorSave";

const editors = new Map<Protyle, {dispose: () => void, remove: () => void, flushing?: Promise<void>,
    save: ReturnType<typeof registerEditorSave>}>();
let activeEditor: Protyle;
let listening = false;

export const getMobileSecondaryEditors = () => Array.from(editors.keys());

export const getActiveMobileSecondaryEditor = () => {
    if (activeEditor && (!editors.has(activeEditor) || !activeEditor.protyle.element.isConnected ||
        activeEditor.protyle.element.closest("[inert]") ||
        activeEditor.protyle.element.getClientRects().length === 0)) {
        activeEditor = undefined;
    }
    return activeEditor;
};

export const clearActiveMobileSecondaryEditor = () => {
    activeEditor = undefined;
};

export const createMobileSecondaryEditorCloseGuard = (getEditor: () => Protyle, ready = () => true) => async () => {
    if (!ready()) return false;
    const editor = getEditor();
    if (editor) {
        if (editor.isUploading()) throw new Error(window.siyuan.languages.uploading);
        await flushMobileSecondaryEditor(editor);
    }
    return true;
};

export const flushMobileSecondaryEditor = (editor: Protyle) => {
    const record = editors.get(editor);
    const flushing = Promise.resolve(record?.flushing).catch((): undefined => undefined).then(async () => {
        await editor.flushPendingTransactions();
        await record?.save.flush(async ids => {
            const {transaction} = await import("../../protyle/wysiwyg/transaction");
            const protyle = editor.protyle;
            if (editors.get(editor) !== record || !protyle.element.isConnected || protyle.disabled ||
                window.siyuan.config.readonly) {
                throw new Error(window.siyuan.languages.settingsPendingSaveError);
            }
            const blocks = Array.from(protyle.wysiwyg.element.querySelectorAll<HTMLElement>("[data-node-id]"));
            // 只从仍有效的编辑 DOM 重建失败文本更新，不保留或重放结构事务。
            const operations: IOperation[] = ids.map(id => {
                const block = blocks.find(item => item.dataset.nodeId === id);
                if (!block) throw new Error(window.siyuan.languages.settingsPendingSaveError);
                return {action: "update", id, data: block.outerHTML};
            });
            await transaction(protyle, operations, undefined, {awaitResponse: true});
        });
    });
    if (record) {
        record.flushing = flushing;
        const release = () => {
            if (record.flushing === flushing) {
                record.flushing = undefined;
            }
        };
        void flushing.then(release, release);
    }
    return flushing;
};

export const unregisterMobileSecondaryEditor = (editor: Protyle) => {
    editors.get(editor)?.dispose();
    editors.delete(editor);
    if (activeEditor === editor) {
        activeEditor = undefined;
    }
};

export const removeMobileSecondaryEditor = (editor: Protyle) => {
    const record = editors.get(editor);
    if (!record) {
        return false;
    }
    record.remove();
    return true;
};

export const registerMobileSecondaryEditor = (editor: Protyle, remove: () => void) => {
    if (!listening) {
        listening = true;
        const followFocus = (event: Event) => {
            const target = event.target as HTMLElement;
            const protyleElement = target.closest(".protyle");
            if (target.id === "toolbarName" ||
                protyleElement && !Array.from(editors.keys()).some(item => item.protyle.element === protyleElement)) {
                activeEditor = undefined;
            }
        };
        document.addEventListener("pointerdown", followFocus, true);
        document.addEventListener("focusin", followFocus, true);
    }
    unregisterMobileSecondaryEditor(editor);
    const save = registerEditorSave(editor.protyle);
    const activate = () => { activeEditor = editor; };
    const flush = () => {
        void flushMobileSecondaryEditor(editor).catch(error => console.error(error));
    };
    const element = editor.protyle.element;
    element.addEventListener("pointerdown", activate, true);
    element.addEventListener("focusin", activate, true);
    element.addEventListener("focusout", flush, true);
    editors.set(editor, {
        remove,
        save,
        dispose: () => {
            save.dispose();
            element.removeEventListener("pointerdown", activate, true);
            element.removeEventListener("focusin", activate, true);
            element.removeEventListener("focusout", flush, true);
        }
    });
};
