import type {Protyle} from "../index";
import {showMessage} from "../../dialog/message";

const closingEditors = new WeakSet<Protyle>();

// 富文本标题需要等到源事务得到确认才能关闭页签；失败时保留可恢复的编辑器。
export const flushDocumentTitleBeforeClose = (editor: Protyle, close: () => void, isValid: () => boolean) => {
    if (closingEditors.has(editor)) {
        return true;
    }
    const pending = editor.protyle.title?.flushPendingInput();
    if (!pending) {
        return false;
    }
    closingEditors.add(editor);
    void pending.then(() => {
        // 源失效会直接清理页签，已等待中的普通关闭不能再提交被移除文档的正文。
        if (isValid()) return editor.flushPendingTransactions();
    }).then(() => {
        if (isValid()) close();
    }).catch(error => {
        if (isValid()) {
            console.error(error);
            showMessage(error instanceof Error ? error.message : window.siyuan.languages.settingsPendingSaveError);
        }
    }).finally(() => closingEditors.delete(editor));
    return true;
};
