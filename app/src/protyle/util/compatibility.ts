export const writeText = async (text: string) => {
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
    if (hotkey.startsWith("⌘")) {
        hotkey = hotkey.replace("⌘", "⌘+");
    } else if (hotkey.startsWith("⌥") && hotkey.substr(1, 1) !== "⌘") {
        hotkey = hotkey.replace("⌥", "⌥+");
    } else if (hotkey.startsWith("⇧⌘") || hotkey.startsWith("⌥⌘")) {
        hotkey = hotkey.replace("⇧⌘", "⌘+⇧+").replace("⌥⌘", "⌘+⌥+");
    } else if (hotkey.startsWith("⇧")) {
        hotkey = hotkey.replace("⇧", "⇧+");
    }
    hotkey = hotkey.replace("⌘", "Ctrl").replace("⇧", "Shift")
        .replace("⌥", "Alt").replace("⇥", "Tab")
        .replace("⌫", "Backspace").replace("⌦", "Delete")
        .replace("↩", "Enter");
    if (hotkey.indexOf("Shift") > -1) {
        hotkey = hotkey.replace(";", ":").replace("=", "+").replace("-", "_").replace(".", ">");
    }
    return hotkey;
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
