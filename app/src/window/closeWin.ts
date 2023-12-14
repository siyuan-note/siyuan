import {App} from "../index";
import {Constants} from "../constants";
import { ipcRenderer } from "electron";

export const closeWindow = async (app: App) => {
    for (let i = 0; i < app.plugins.length; i++) {
        try {
            await app.plugins[i].onunload();
        } catch (e) {
            console.error(e);
        }
    }
    ipcRenderer.send(Constants.SIYUAN_CMD, "destroy");
};
