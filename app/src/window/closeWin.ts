import type {App} from "../index";
import {Constants} from "../constants";
import {ipcRenderer} from "electron";
import {destroyWindowPluginKernels} from "./closeWinCore";

export const closeWindow = (app: App) => {
    destroyWindowPluginKernels(app.plugins, error => console.error(error));
    ipcRenderer.send(Constants.SIYUAN_CMD, "destroy");
};
