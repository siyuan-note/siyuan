import {App} from "../index";
import {getCurrentWindow} from "@electron/remote";

export const closeWindow = async (app: App) => {
    for (let i = 0; i < app.plugins.length; i++) {
        try {
            await app.plugins[i].onunload();
        } catch (e) {
            console.error(e);
        }
    }
    getCurrentWindow().destroy();
};
