import {getMobileEditorDialog, type MobileEditorDialog} from "./MobileEditorDialog";
import {BacklinkContent} from "../../layout/dock/BacklinkContent";
import {activeBlur} from "./keyboardToolbar";
import {registerMobileBacklinkPanel} from "./backlinkPanels";
import {clearActiveMobileSecondaryEditor, flushMobileSecondaryEditor} from "./secondaryEditors";
import {bindBottomSheetDialog} from "./bindBottomSheetDialog";

let currentDialog: MobileEditorDialog;
let openVersion = 0;

export const openMobileBacklinks = async (protyle: IProtyle, blockId: string) => {
    const version = ++openVersion;
    activeBlur(true);
    window.siyuan.menus.menu.remove();
    try {
        await currentDialog?.close();
    } catch (error) {
        console.error(error);
        return;
    }
    if (version !== openVersion || !protyle.element.isConnected) {
        return;
    }
    const MobileEditorDialog = getMobileEditorDialog();
    const dialog = new MobileEditorDialog({
        content: '<div class="mobile-backlinks-content fn__flex-column"></div>',
        width: "100vw",
        height: "auto",
        containerClassName: "mobile-backlinks-sheet",
        hideCloseIcon: true,
        destroyCallback: () => {
            disposeSheet();
            unregisterPanel?.();
            panel?.destroy();
            if (currentDialog === dialog) {
                currentDialog = undefined;
                clearActiveMobileSecondaryEditor();
            }
        }
    });
    currentDialog = dialog;
    dialog.element.classList.add("mobile-backlinks-dialog");
    const panel = new BacklinkContent({
        app: protyle.app,
        element: dialog.element.querySelector(".mobile-backlinks-content"),
        blockId,
        rootId: protyle.block.rootID,
        notebookId: protyle.notebookId,
        type: "local",
        surface: "mobile-sheet",
        onlyBacklinks: true,
    });
    dialog.beforeClose = async () => {
        if (dialog.element.contains(document.activeElement)) {
            activeBlur(true);
        }
        dialog.element.setAttribute("inert", "");
        // 在移除编辑器及其 WebSocket 之前，将防抖输入提交到事务队列。
        try {
            await Promise.all(panel.editors.map(flushMobileSecondaryEditor));
        } catch (error) {
            dialog.element.removeAttribute("inert");
            throw error;
        }
        unregisterPanel?.();
        panel.destroy();
        if (currentDialog === dialog) {
            clearActiveMobileSecondaryEditor();
        }
    };
    dialog.register();
    const unregisterPanel = registerMobileBacklinkPanel(panel);
    const disposeSheet = bindBottomSheetDialog(dialog, () => dialog.close());
};
