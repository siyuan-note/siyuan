import {Dialog} from "../../dialog";
import {BacklinkContent} from "../../layout/dock/BacklinkContent";
import {activeBlur} from "./keyboardToolbar";
import {registerMobileBacklinkPanel} from "./backlinkPanels";
import {clearActiveMobileSecondaryEditor, flushMobileSecondaryEditor} from "./secondaryEditors";
import {showMessage} from "../../dialog/message";
import {escapeHtml} from "../../util/escape";

class MobileBacklinkDialog extends Dialog {
    public beforeClose: () => Promise<void>;
    private closing?: Promise<void>;

    public close() {
        if (!this.closing) {
            this.closing = Promise.resolve().then(() => this.beforeClose?.()).then(() => {
                super.destroy();
            }).catch(error => {
                this.closing = undefined;
                showMessage(escapeHtml(String(error)));
                throw error;
            });
        }
        return this.closing;
    }

    public destroy() {
        void this.close().catch(error => console.error(error));
    }
}

let currentDialog: MobileBacklinkDialog;
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
    const dialog = new MobileBacklinkDialog({
        content: '<div class="mobile-backlinks-content fn__flex-column"></div>',
        width: "100vw",
        height: "60vh",
        containerClassName: "mobile-backlinks-sheet",
        destroyCallback: () => {
            unregisterPanel?.();
            panel?.destroy();
            if (currentDialog === dialog) {
                currentDialog = undefined;
                clearActiveMobileSecondaryEditor();
            }
            window.visualViewport?.removeEventListener("resize", resize);
            window.visualViewport?.removeEventListener("scroll", resize);
        }
    });
    currentDialog = dialog;
    dialog.element.classList.add("mobile-backlinks-dialog");
    const resize = () => {
        const viewport = window.visualViewport;
        const container = dialog.element.querySelector<HTMLElement>(".b3-dialog");
        if (viewport) {
            container.style.top = `${viewport.offsetTop}px`;
            container.style.height = `${viewport.height}px`;
        }
    };
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    resize();
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
    const unregisterPanel = registerMobileBacklinkPanel(panel, () => dialog.close());
};
