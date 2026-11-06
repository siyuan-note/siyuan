import type {Protyle} from "../protyle";
import type {MobileDialog} from "../dialog/mobileDialog";
import {isMobile} from "../util/functions";
import {createMobileSecondaryEditorCloseGuard} from "../mobile/util/secondaryEditors";

export const runCardAction = (dialog: MobileDialog, editor: Protyle, action: () => void | Promise<void>) => {
    if (!isMobile()) return Promise.resolve(action());
    // 换卡会更新按钮的业务禁用状态，输入锁只使用 inert，避免恢复时覆盖这些状态。
    return dialog.runPending(async () => {
        if (!await createMobileSecondaryEditorCloseGuard(() => editor)()) return false;
        if (!dialog.element.isConnected || editor && (!editor.protyle.element.isConnected ||
            !editor.protyle.element.classList.contains("protyle"))) return false;
        await action();
        return false;
    }, {close: false, disableButtons: false});
};
