/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif

let revision = 0;
let listening = false;

export const closeSettingDialog = () => {
    window.siyuan.dialogs.find(item => item.element.querySelector(".config__tab-container"))?.destroy();
};

export const acceptSettingInterfaceRevision = (next: number) => {
    if (!Number.isSafeInteger(next) || next < revision) return false;
    revision = next;
    return true;
};

export const watchSettingInterface = () => {
    /// #if !BROWSER
    if (listening) return;
    listening = true;
    ipcRenderer.on("siyuan-settings-interface", (_event, next: number) => {
        if (next > revision && acceptSettingInterfaceRevision(next)) closeSettingDialog();
    });
    /// #endif
};

export const prepareSettingDialog = () => {
    /// #if !BROWSER
    watchSettingInterface();
    // 同步取得工作区的打开次序，保留插件 API 的同步返回，并忽略迟到的关闭通知。
    if (!acceptSettingInterfaceRevision(ipcRenderer.sendSync("siyuan-settings-open-dialog"))) {
        throw new Error("Could not coordinate the settings dialog");
    }
    /// #endif
};
