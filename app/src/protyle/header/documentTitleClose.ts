import type {Protyle} from "../index";
import {showMessage} from "../../dialog/message";

const closingEditors = new WeakMap<Protyle, {
    request: {close: () => void; isValid: () => boolean; canClose?: () => boolean};
    result: Promise<boolean>;
}>();

// 富文本标题需要等到源事务得到确认才能关闭页签；失败时保留可恢复的编辑器。
export const flushDocumentTitleBeforeClose = (editor: Protyle, close: () => void, isValid: () => boolean,
                                              canClose?: () => boolean): false | Promise<boolean> => {
    const existing = closingEditors.get(editor);
    if (existing) {
        if (existing.request.canClose && !canClose) {
            // 超限清理与显式关闭共用待确认的保存，显式关闭优先。
            Object.assign(existing.request, {close, isValid, canClose});
        }
        return existing.result;
    }
    const pending = editor.protyle.title?.flushPendingInput();
    if (!pending) {
        return false;
    }
    const request = {close, isValid, canClose};
    const result = pending.then(() => {
        // 源失效会直接清理页签，已等待中的普通关闭不能再提交被移除文档的正文。
        if (request.isValid()) return editor.flushPendingTransactions();
    }).then(() => {
        if (!request.isValid() || request.canClose?.() === false) return false;
        request.close();
        return true;
    }).catch(error => {
        if (request.isValid()) {
            console.error(error);
            showMessage(error instanceof Error ? error.message : window.siyuan.languages.settingsPendingSaveError);
        }
        return false;
    }).finally(() => closingEditors.delete(editor));
    closingEditors.set(editor, {request, result});
    return result;
};
