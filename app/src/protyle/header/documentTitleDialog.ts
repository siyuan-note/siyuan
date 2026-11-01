import type {App} from "../../index";
import {Dialog} from "../../dialog";
import {showMessage} from "../../dialog/message";
import {Constants} from "../../constants";
import {Protyle} from "../index";
import {registerEditorSave} from "../util/editorSave";
import {escapeHtml} from "../../util/escape";
import {registerDocumentTitleDialog} from "./documentTitleDialogs";
import {confirmDocumentTitle} from "./documentTitleEditor";
/// #if MOBILE
import {registerMobileSecondaryEditor} from "../../mobile/util/secondaryEditors";
import {bindBottomSheetDialog} from "../../mobile/util/bindBottomSheetDialog";
import {getVisibleViewportBounds} from "../../mobile/util/visibleViewport";
import {callMobileAppShowKeyboard} from "../../mobile/util/mobileAppUtil";
/// #endif

// 重命名使用独立草稿，保存失败时保留输入。
export const openDocumentTitleDialog = (options: {id: string, notebook?: string, app?: App}) => {
    let closePending = false;
    let canClose = false;
    let disposed = false;
    let disposeSheet = () => {};
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        disposeSheet?.();
        unregister?.();
        guard?.dispose();
        editor?.destroy();
        editor?.protyle.element.replaceChildren();
        dialog.editors = {};
    };
    const closeInvalidated = () => {
        canClose = true;
        dispose();
        dialog.destroy();
    };
    const close = async () => {
        if (closePending || disposed) {
            return;
        }
        closePending = true;
        try {
            await confirmDocumentTitle(editor.protyle, async () => {
                await editor.flushPendingTransactions();
                await guard?.flush();
                if (disposed) return;
                await editor.protyle.title?.flushPendingInput();
            });
            if (disposed) return;
            canClose = true;
            dialog.destroy();
        } catch (error) {
            if (!disposed) {
                console.error(error);
                showMessage(window.siyuan.languages.settingsPendingSaveError);
            }
        } finally {
            closePending = false;
        }
    };
    let width = "560px";
    /// #if MOBILE
    width = "100vw";
    /// #endif
    const dialog = new Dialog({
        title: window.siyuan.languages.rename,
        width,
        /// #if MOBILE
        height: "auto",
        containerClassName: "mobile-document-title-sheet",
        hideCloseIcon: true,
        /// #endif
        content: `<div class="document-title-dialog"></div><div class="b3-dialog__action">
<button class="b3-button b3-button--text" data-type="confirm">${escapeHtml(window.siyuan.languages.confirm)}</button></div>`,
        beforeClose: () => {
            if (closePending && !canClose) return false;
            dispose();
            return true;
        },
        destroyCallback: dispose,
    });
    dialog.element.dataset.key = Constants.DIALOG_RENAME;
    /// #if MOBILE
    dialog.element.classList.add("mobile-document-title-dialog");
    const keyboardToolbar = document.getElementById("keyboardToolbar");
    let editorReady = false;
    let sheetReady = false;
    let focusPending = true;
    const isCurrent = () => !disposed && dialog.element.isConnected &&
        window.siyuan.dialogs[window.siyuan.dialogs.length - 1] === dialog;
    const canFocus = () => !closePending && isCurrent() && !editor.protyle.disabled &&
        !window.siyuan.config.readonly && !window.siyuan.isPublish;
    const focusTitle = async () => {
        if (!focusPending || !editorReady || !sheetReady || !canFocus()) return;
        focusPending = false;
        await editor.protyle.title?.openEditor(canFocus);
        if (!canFocus()) return;
        const input = editor.protyle.title?.editElement;
        if (!input?.isConnected || input.getAttribute("contenteditable") !== "true") return;
        input.focus({preventScroll: true});
        if (input.ownerDocument.activeElement === input) callMobileAppShowKeyboard();
    };
    const resize = () => {
        const viewport = getVisibleViewportBounds();
        const bottom = keyboardToolbar && !keyboardToolbar.classList.contains("fn__none") ?
            Math.min(viewport.bottom, keyboardToolbar.getBoundingClientRect().top) : viewport.bottom;
        const container = dialog.element.querySelector<HTMLElement>(".b3-dialog");
        container.style.top = `${viewport.top}px`;
        container.style.height = `${Math.max(0, bottom - viewport.top)}px`;
    };
    const unbindSheet = bindBottomSheetDialog(dialog, async () => { dialog.destroy(); }, resize, () => {
        sheetReady = true;
        void focusTitle().catch(error => console.error(error));
    });
    const toolbarObserver = new MutationObserver(resize);
    if (keyboardToolbar) {
        toolbarObserver.observe(keyboardToolbar, {attributes: true, attributeFilter: ["class", "style"]});
    }
    window.addEventListener("resize", resize);
    disposeSheet = () => {
        unbindSheet();
        toolbarObserver.disconnect();
        window.removeEventListener("resize", resize);
    };
    /// #endif
    const editor = new Protyle(options.app || window.siyuan.ws.app,
        dialog.element.querySelector<HTMLElement>(".document-title-dialog"), {
            blockId: options.id,
            notebookId: options.notebook,
            action: [Constants.CB_GET_ROOTSCROLL],
            render: {background: false, title: true, titleShowTop: false, breadcrumb: false, gutter: false, scroll: false},
            after: (protyle) => {
                if (!disposed) {
                    /// #if MOBILE
                    const owner = protyle.protyle;
                    let field = owner.element.querySelector<HTMLElement>(":scope > .document-title-dialog__editor");
                    if (!field) {
                        field = document.createElement("div");
                        field.className = "document-title-dialog__editor b3-text-field";
                        owner.element.appendChild(field);
                    }
                    owner.title?.mountEditorOnly(field);
                    editorReady = true;
                    void focusTitle().catch(error => console.error(error));
                    /// #else
                    void protyle.protyle.title?.openEditor().catch(error => console.error(error));
                    /// #endif
                }
            },
        });
    const guard = registerEditorSave(editor.protyle);
    dialog.editors = {title: editor};
    const unregister = registerDocumentTitleDialog(editor, options.id, options.notebook, closeInvalidated);
    /// #if MOBILE
    registerMobileSecondaryEditor(editor, closeInvalidated);
    /// #endif
    dialog.element.querySelector('[data-type="confirm"]').addEventListener("click", () => void close());
    return dialog;
};
