/// #if !BROWSER && !MOBILE
import {ipcRenderer} from "electron";
/// #endif
import {fetchSyncPost} from "../../util/fetch";
import {showMessage} from "../../dialog/message";

export const runSettingsMaintenance = async (action: () => Promise<void>) => {
    let id: string;
    try {
        /// #if !BROWSER && !MOBILE
        id = await ipcRenderer.invoke("siyuan-settings-task-start");
        const flushed = await fetchSyncPost("/api/sqlite/flushTransaction", {});
        if (flushed.code !== 0) throw new Error(flushed.msg);
        /// #endif
        await action();
    } catch (error) {
        console.error("Settings maintenance preparation failed", error);
        showMessage(window.siyuan.languages.settingsPendingSaveError, 6000, "error");
    } finally {
        /// #if !BROWSER && !MOBILE
        if (id) await ipcRenderer.invoke("siyuan-settings-task-end", id);
        /// #endif
    }
};
