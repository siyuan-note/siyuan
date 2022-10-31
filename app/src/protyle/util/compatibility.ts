import {focusByRange} from "./selection";
import {fetchPost} from "../../util/fetch";

export const openByMobile = (uri: string) => {
    if (!uri) {
        return;
    }
    if (window.siyuan.config.system.container === "ios") {
        window.location.href = uri;
    } else if (window.siyuan.config.system.container === "android" && window.JSAndroid) {
        window.JSAndroid.openExternal(uri);
    } else {
        window.open(uri);
    }
};

export const readText = async () => {
    if ("android" === window.siyuan.config.system.container && window.JSAndroid) {
        return window.JSAndroid.readClipboard();
    }
    return navigator.clipboard.readText();
};

export const writeText = async (text: string) => {
    let range: Range;
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0).cloneRange();
    }
    try {
        // navigator.clipboard.writeText 抛出异常不进入 catch，这里需要先处理移动端复制
        if ("android" === window.siyuan.config.system.container && window.JSAndroid) {
            window.JSAndroid.writeClipboard(text);
            return;
        }
        if ("ios" === window.siyuan.config.system.container && window.webkit?.messageHandlers) {
            window.webkit.messageHandlers.setClipboard.postMessage(text);
            return;
        }

        navigator.clipboard.writeText(text);
    } catch (e) {
        if (window.siyuan.config.system.container === "ios" && window.webkit?.messageHandlers) {
            window.webkit.messageHandlers.setClipboard.postMessage(text);
        } else if (window.siyuan.config.system.container === "android" && window.JSAndroid) {
            window.JSAndroid.writeClipboard(text);
        } else {
            const textElement = document.createElement("textarea");
            textElement.value = text;
            textElement.style.position = "fixed";  //avoid scrolling to bottom
            document.body.appendChild(textElement);
            textElement.focus();
            textElement.select();
            document.execCommand("copy");
            document.body.removeChild(textElement);
            if (range) {
                focusByRange(range);
            }
        }
    }
};

// 用户 iPhone 点击延迟/需要双击的处理
export const getEventName = () => {
    if (navigator.userAgent.indexOf("iPhone") > -1) {
        return "touchstart";
    } else {
        return "click";
    }
};

// 区别 mac 上的 ctrl 和 meta
export const isCtrl = (event: KeyboardEvent) => {
    if (isMac()) {
        // mac
        if (event.metaKey && !event.ctrlKey) {
            return true;
        }
        return false;
    } else {
        if (!event.metaKey && event.ctrlKey) {
            return true;
        }
        return false;
    }
};

export const isMac = () => {
    return navigator.platform.toUpperCase().indexOf("MAC") > -1;
};

// Mac，Windows 快捷键展示
export const updateHotkeyTip = (hotkey: string) => {
    if (/Mac/.test(navigator.platform) || navigator.platform === "iPhone") {
        return hotkey;
    }

    const KEY_MAP = new Map(Object.entries({
        "⌘": "Ctrl",
        "⇧": "Shift",
        "⌥": "Alt",
        "⇥": "Tab",
        "⌫": "Backspace",
        "⌦": "Delete",
        "↩": "Enter",
    }));

    const keys = [];

    if (hotkey.indexOf("⌘") > -1) keys.push(KEY_MAP.get("⌘"));
    if (hotkey.indexOf("⇧") > -1) keys.push(KEY_MAP.get("⇧"));
    if (hotkey.indexOf("⌥") > -1) keys.push(KEY_MAP.get("⌥"));

    // 不能去最后一个，需匹配 F2
    const lastKey = hotkey.replace(/⌘|⇧|⌥/g, "");
    if (lastKey) {
        keys.push(KEY_MAP.get(lastKey) || lastKey);
    }

    return keys.join("+");
};

export const hotKey2Electron = (key: string) => {
    let electronKey = "";
    if (key.indexOf("⌘") > -1) {
        electronKey += "CommandOrControl+";
    }
    if (key.indexOf("⇧") > -1) {
        electronKey += "Shift+";
    }
    if (key.indexOf("⌥") > -1) {
        electronKey += "Alt+";
    }
    return electronKey + key.substr(key.length - 1);
};

export const setLocalStorage = () => {
    fetchPost("/api/storage/getLocalStorage", undefined, (response) => {
        if (response.data) {
            localStorage.clear();
            Object.keys(response.data).forEach(item => {
                if (item !== "setItem" && item !== "removeItem") {
                    localStorage.setItem(item, response.data[item]);
                }
            });
        } else {
            exportLocalStorage();
        }
    });

    // 复写 localStorage
    window.__localStorage__setItem = localStorage.setItem;
    window.__localStorage__removeItem = localStorage.removeItem;
    localStorage.setItem = function (key, val) {
        window.__localStorage__setItem.call(this, key, val);
        fetchPost("/api/storage/setLocalStorageVal", {key, val});
    };
    localStorage.removeItem = function (key) {
        window.__localStorage__removeItem.call(this, key);
        fetchPost("/api/storage/removeLocalStorageVal", {key});
    };
};

export const exportLocalStorage = (cb?: () => void) => {
    fetchPost("/api/storage/setLocalStorage", {val: localStorage}, () => {
        if (cb) {
            cb();
        }
    });
};
