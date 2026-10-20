import type {App} from "../index";
import {Constants} from "../constants";
import {ipcRenderer} from "electron";
import {destroyWindowPluginKernels} from "./closeWinCore";
import {flushWindowWorkspace} from "./workspace";
import {showMessage} from "../dialog/message";
import {isWindow} from "../util/functions";
import {getAllTabs} from "../layout/getAll";
import type {Protyle} from "../protyle";

let closing = false;
const pendingTabSaves = new Set<Promise<boolean>>();

export const flushClosingWindowTab = (editor: Protyle) => {
    if (!isWindow() || !window.siyuan.config.fileTree.closeWindowOnLastTabClosed) {
        return;
    }
    const task = editor.flushPendingTransactions().then(() => {
        pendingTabSaves.delete(task);
        return true;
    }, error => {
        console.error(error);
        return false;
    });
    pendingTabSaves.add(task);
};

export const closeWindow = async (app: App, shouldClose?: () => boolean) => {
    if (closing) {
        return;
    }
    closing = true;
    try {
        if (!await flushWindowWorkspace()) {
            showMessage(window.siyuan.languages.windowWorkspaceSaveError, 6000, "error");
            return;
        }
        // A new tab can arrive while the detached window's workspace is saving.
        if (shouldClose && !shouldClose()) {
            return;
        }
        destroyWindowPluginKernels(app.plugins, error => console.error(error));
        ipcRenderer.send(Constants.SIYUAN_CMD, "destroy");
    } catch (error) {
        console.error(error);
        showMessage(window.siyuan.languages.windowWorkspaceSaveError, 6000, "error");
    } finally {
        closing = false;
    }
};

export const closeWindowAfterLastTab = async (app: App) => {
    const shouldClose = () => isWindow() &&
        window.siyuan.config.fileTree.closeWindowOnLastTabClosed &&
        !!window.siyuan.layout.centerLayout &&
        !getAllTabs().some(tab => !!tab.headElement);
    // Finish synchronous tab replacement/layout changes before checking the window.
    await Promise.resolve();
    if (shouldClose()) {
        while (pendingTabSaves.size) {
            const saves = Array.from(pendingTabSaves);
            if ((await Promise.all(saves)).some(saved => !saved)) {
                saves.forEach(save => pendingTabSaves.delete(save));
                showMessage(window.siyuan.languages.windowWorkspaceSaveError, 6000, "error");
                return;
            }
        }
        if (!shouldClose()) {
            return;
        }
        await closeWindow(app, shouldClose);
    }
};
