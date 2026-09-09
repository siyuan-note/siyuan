import type {Protyle} from "../../protyle";
import {waitForPendingTransactions} from "../../protyle/util/transactionQueue";

const editors = new Map<Protyle, {dispose: () => void, remove: () => void, flushing?: Promise<void>}>();
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

export const flushMobileSecondaryEditor = (editor: Protyle) => {
    const record = editors.get(editor);
    const flushing = Promise.all([record?.flushing, editor.protyle.wysiwyg.flushPendingInput()])
        .then(() => waitForPendingTransactions(editor.protyle));
    if (record) {
        record.flushing = flushing;
        void flushing.then(() => {
            if (record.flushing === flushing) {
                record.flushing = undefined;
            }
        }, () => undefined);
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
        dispose: () => {
            element.removeEventListener("pointerdown", activate, true);
            element.removeEventListener("focusin", activate, true);
            element.removeEventListener("focusout", flush, true);
        }
    });
};
