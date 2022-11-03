import {isCtrl} from "./compatibility";
import {Constants} from "../../constants";

// 是否匹配 ⇧⌘[] / ⌘[] / ⌥[] / ⌥⌘[] / ⌥⇧[] / ⌥⇧⌘[] / ⇧[] / []
export const matchHotKey = (hotKey: string, event: KeyboardEvent) => {
    if (hotKey === "") {
        return false;
    }

    // []
    if (hotKey.indexOf("⇧") === -1 && hotKey.indexOf("⌘") === -1 && hotKey.indexOf("⌥") === -1 && hotKey.indexOf("⌃") === -1) {
        if (hotKey === "⇥") {
            hotKey = "Tab";
        }
        if (!event.ctrlKey && !isCtrl(event) && !event.altKey && !event.shiftKey && event.code === hotKey) {
            return true;
        }
        return false;
    }

    const hotKeys = hotKey.split("");
    if (hotKey.endsWith("↑") || hotKey.endsWith("↓") || hotKey.endsWith("→") || hotKey.endsWith("←") ||
        hotKey.endsWith("↩") || hotKey.endsWith("⇥") || hotKey.indexOf("F") > -1) {
        hotKeys.forEach((item, index) => {
            if (item === "↑") {
                hotKeys[index] = "ArrowUp";
            } else if (item === "↓") {
                hotKeys[index] = "ArrowDown";
            } else if (item === "←") {
                hotKeys[index] = "ArrowLeft";
            } else if (item === "→") {
                hotKeys[index] = "ArrowRight";
            } else if (item === "⇥") {
                hotKeys[index] = "Tab";
            } else if (item === "↩") {
                hotKeys[index] = "Enter";
            } else if (item === "F") {
                // F1-F12
                hotKeys[index] = "F" + hotKeys.splice(index + 1, 1);
                if (hotKeys[index + 1]) {
                    hotKeys[index + 1] += hotKeys.splice(index + 1, 1);
                }
            }
        });
    }

    // 是否匹配 ⇧[]
    if (hotKey.startsWith("⇧") && hotKeys.length === 2) {
        if (!event.ctrlKey && !isCtrl(event) && !event.altKey && event.shiftKey) {
            if (event.code.startsWith("Digit") || event.code.startsWith("Numpad")) {
                if (hotKeys[1] === event.code.slice(-1) || event.key === hotKeys[1]) {
                    return true;
                }
            } else if (event.key === hotKeys[1]) {
                return true;
            }
        }
        return false;
    }

    if (hotKey.startsWith("⌥")) {
        let keyCode = hotKeys.length === 3 ? hotKeys[2] : hotKeys[1];
        if (hotKeys.length === 4) {
            keyCode = hotKeys[3];
        }

        let isMatchKey = (/^[0-9]$/.test(keyCode) ? (event.code === "Digit" + keyCode || event.code === "Numpad" + keyCode) : event.code === "Key" + keyCode) ||
            event.code === keyCode ||
            event.key === keyCode;  // 小键盘上的 /*-+.
        if (Constants.KEYCODE[event.keyCode]) {
            if (event.shiftKey) {
                isMatchKey = Constants.KEYCODE[event.keyCode][1] === keyCode;
            } else {
                isMatchKey = Constants.KEYCODE[event.keyCode][0] === keyCode;
            }
        }
        // 是否匹配 ⌥[] / ⌥⌘[]
        if (isMatchKey && event.altKey && !event.shiftKey &&
            (hotKeys.length === 3 ? (isCtrl(event) && hotKey.startsWith("⌥⌘")) : !isCtrl(event))) {
            return true;
        }
        // ⌥⇧⌘[]
        if (isMatchKey && hotKey.startsWith("⌥⇧⌘") && hotKeys.length === 4 &&
            event.altKey && event.shiftKey && isCtrl(event)) {
            return true;
        }
        // ⌥⇧[]
        if (isMatchKey && hotKey.startsWith("⌥⇧") && hotKeys.length === 3 &&
            event.altKey && event.shiftKey && !isCtrl(event)) {
            return true;
        }
        return false;
    }

    // 是否匹配 ⇧⌘[] / ⌘[]
    const hasShift = hotKeys.length > 2 && (hotKeys[0] === "⇧");
    if (isCtrl(event) && !event.altKey && ((!hasShift && !event.shiftKey) || (hasShift && event.shiftKey))) {
        const keyCode = (hasShift ? hotKeys[2] : hotKeys[1]);
        let isMatchKey = (/^[0-9]$/.test(keyCode) ? (event.code === "Digit" + keyCode || event.code === "Numpad" + keyCode) : event.code === "Key" + keyCode) ||
            event.code === keyCode || event.key.toLowerCase() === keyCode.toLowerCase();
        // 更新 electron 后不需要判断 Mac，但 Mac 下中英文有区别，需使用 keyCode 辅助
        if (Constants.KEYCODE[event.keyCode]) {
            if (event.shiftKey) {
                isMatchKey = Constants.KEYCODE[event.keyCode][1] === keyCode;
            } else {
                isMatchKey = Constants.KEYCODE[event.keyCode][0] === keyCode;
            }
        }
        return isMatchKey;
    }
    return false;
};

