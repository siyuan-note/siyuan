import * as compatibility from "../protyle/util/compatibility";
/// #if !BROWSER
import {ipcRenderer} from "electron";
import {Constants} from "../constants";
/// #endif
export const openByMobile = compatibility.openByMobile;
export const readText = compatibility.readText;
export const writeText = compatibility.writeText;
export const copyPlainText = compatibility.copyPlainText;
export const getEventName = compatibility.getEventName;
export const isOnlyMeta = compatibility.isOnlyMeta;
export const isNotCtrl = compatibility.isNotCtrl;
export const isHuawei = compatibility.isHuawei;
export const isIPhone = compatibility.isIPhone;
export const isIPad = compatibility.isIPad;
export const isMac = compatibility.isMac;
export const isInAndroid = compatibility.isInAndroid;
export const isInIOS = compatibility.isInIOS;
export const updateHotkeyTip = compatibility.updateHotkeyTip;
export const getLocalStorage = compatibility.getLocalStorage;
export const setStorageVal = compatibility.setStorageVal;

export interface ISendNotificationOptions {
    channel?: string,
    title?: string,
    body?: string,
    delayInSeconds?: number,
    timeoutType?: "default" | "never" // 该参数仅在桌面端有效
}

export const sendNotification = (options: ISendNotificationOptions): Promise<number> => {
    return new Promise((resolve) => {
        const title = options.title || "";
        const body = options.body || "";
        const delayInSeconds = options.delayInSeconds || 0;
        if (!title.trim() && !body.trim()) {
            // 不能同时为空
            resolve(-1);
            return;
        }

        /// #if BROWSER
        const channel = options.channel || "SiYuan Notifications";
        if (window.JSAndroid && window.JSAndroid.sendNotification) {
            const id = window.JSAndroid.sendNotification(channel, title, body, delayInSeconds);
            resolve(id);
        } else if (window.JSHarmony && window.JSHarmony.sendNotification) {
            const id = window.JSHarmony.sendNotification(channel, title, body, delayInSeconds);
            resolve(id);
        } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.sendNotification) {
            const callbackId = "cb_" + Date.now();
            // 定义临时回调
            if (!window.webkit.nativeCallbacks) {
                window.webkit.nativeCallbacks = {};
            }
            window.webkit.nativeCallbacks[callbackId] = (id: number) => {
                delete window.webkit.nativeCallbacks[callbackId];
                resolve(id);
            };
            window.webkit.messageHandlers.sendNotification.postMessage({
                title,
                body,
                delay: delayInSeconds,
                callback: `window.webkit.nativeCallbacks.${callbackId}`
            });
        } else {
            resolve(-1);
        }
        /// #else
        const timeoutType = options.timeoutType || "never";
        const timeoutId = window.setTimeout(() => {
            ipcRenderer.send(Constants.SIYUAN_CMD, {
                cmd: "notification",
                title,
                body,
                timeoutType
            });
        }, delayInSeconds * 1000);
        resolve(timeoutId);
        /// #endif
    });
};

export const cancelNotification = (id: number) => {
    if (id <= 0) {
        return;
    }
    /// #if BROWSER
    if (window.JSAndroid && window.JSAndroid.cancelNotification) {
        window.JSAndroid.cancelNotification(id);
    } else if (window.JSHarmony && window.JSHarmony.cancelNotification) {
        window.JSHarmony.cancelNotification(id);
    } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.cancelNotification) {
        window.webkit.messageHandlers.cancelNotification.postMessage(id);
    }
    /// else
    clearTimeout(id);
    /// #endif
};
