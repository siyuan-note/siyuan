import type {App} from "../../index";
import {Dialog} from "../../dialog";
import {showMessage} from "../../dialog/message";
import {Constants} from "../../constants";
import {Protyle} from "../index";
import {registerEditorSave} from "../util/editorSave";
import {escapeHtml} from "../../util/escape";
import {registerDocumentTitleDialog} from "./documentTitleDialogs";
/// #if MOBILE
import {registerMobileSecondaryEditor} from "../../mobile/util/secondaryEditors";
/// #endif

// 重命名和移动端顶栏共用完整标题编辑器，保存失败时保留对话框中的输入。
export const openDocumentTitleDialog = (options: {id: string, notebook?: string, app?: App}) => {
    let closePending = false;
    let canClose = false;
    let disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
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
            await editor?.flushPendingTransactions();
            await guard?.flush();
            if (disposed) return;
            await editor?.protyle.title?.flushPendingInput();
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
    const dialog = new Dialog({
        title: window.siyuan.languages.rename,
        width: "560px",
        content: `<div class="document-title-dialog"></div><div class="b3-dialog__action">
<button class="b3-button b3-button--text" data-type="confirm">${escapeHtml(window.siyuan.languages.confirm)}</button></div>`,
        beforeClose: () => {
            if (canClose) {
                return true;
            }
            void close();
            return false;
        },
        destroyCallback: dispose,
    });
    dialog.element.dataset.key = Constants.DIALOG_RENAME;
    const editor = new Protyle(options.app || window.siyuan.ws.app,
        dialog.element.querySelector<HTMLElement>(".document-title-dialog"), {
            blockId: options.id,
            notebookId: options.notebook,
            action: [Constants.CB_GET_ROOTSCROLL],
            render: {background: false, title: true, titleShowTop: false, breadcrumb: false, gutter: false, scroll: false},
            after: (protyle) => {
                if (!disposed) {
                    void protyle.protyle.title?.openEditor().catch(error => console.error(error));
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
