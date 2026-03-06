import * as compatibility from "../protyle/util/compatibility";

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

/// #if BROWSER
export const sendMobileAppNotification = (channel: string, title: string, body: string, delayInSeconds: number): Promise<number> => {
    return new Promise((resolve) => {
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
            window.webkit.nativeCallbacks[callbackId] = (id:number) => {
                delete window.webkit.nativeCallbacks[callbackId];
                resolve(id);
            };
            window.webkit.messageHandlers.sendNotification.postMessage({
                title,
                body,
                delay: delayInSeconds,
                callback: `window.webkit.nativeCallbacks.${callbackId}`
            });
        }
    });
};

export const cancelMobileAppNotification = (id: number) => {
    if (window.JSAndroid && window.JSAndroid.cancelNotification) {
        window.JSAndroid.cancelNotification(id);
    } else if (window.JSHarmony && window.JSHarmony.cancelNotification) {
        window.JSHarmony.cancelNotification(id);
    } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.cancelNotification) {
        window.webkit.messageHandlers.cancelNotification.postMessage(id);
    }
};
/// #endif
