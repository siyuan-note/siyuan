import {App} from "../index";
import {Constants} from "../constants";
import { ipcRenderer } from "electron";

export const closeWindow = async (app: App) => {
    for (let i = 0; i < app.plugins.length; i++) {
        const plugin = app.plugins[i];
        try {
            await plugin.onunload();
        } catch (e) {
            console.error(e);
        }
        await plugin.kernel.destroy();
    }
    ipcRenderer.send(Constants.SIYUAN_CMD, "destroy");
};
