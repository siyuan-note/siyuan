import type {App} from "../index";
import {Constants} from "../constants";
import {ipcRenderer} from "electron";
import {destroyWindowPluginKernels} from "./closeWinCore";
import {flushWindowWorkspace} from "./workspace";
import {showMessage} from "../dialog/message";

let closing = false;
export const closeWindow = async (app: App) => {
    if (closing) {
        return;
    }
    closing = true;
    try {
        if (!await flushWindowWorkspace()) {
            showMessage(window.siyuan.languages.windowWorkspaceSaveError, 6000, "error");
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
