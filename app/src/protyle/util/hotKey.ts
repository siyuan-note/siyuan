import {isCtrl} from "./compatibility";

// 是否匹配 ⇧⌘[] / ⌘[] / ⌥[] / ⌥⌘[] / ⇧Tab / []
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

    // 是否匹配 ⇧Tab/↑
    if (hotKey.startsWith("⇧") && hotKeys.length === 2) {
        if (!event.ctrlKey && !isCtrl(event) && !event.altKey && event.shiftKey && event.key === hotKeys[1]) {
            return true;
        }
        return false;
    }

    if (hotKey.startsWith("⌥")) {
        // 是否匹配 ⌥[] / ⌥⌘[]
        const keyCode = hotKeys.length === 3 ? hotKeys[2] : hotKeys[1];
        if ((hotKeys.length === 3 ? isCtrl(event) : !isCtrl(event)) && event.altKey && !event.shiftKey &&
            (
                (/^[0-9]$/.test(keyCode) ? (event.code === "Digit" + keyCode || event.code === "Numpad" + keyCode) : event.code === "Key" + keyCode) ||
                event.code === keyCode ||
                (event.code === "Period" && keyCode === ".") ||
                (event.code === "BracketLeft" && keyCode === "[") || (event.code === "BracketRight" && keyCode === "]")
            )) {
            return true;
        }
        return false;
    }

    // 是否匹配 ⇧⌘[] / ⌘[]
    const hasShift = hotKeys.length > 2 && (hotKeys[0] === "⇧");
    let key = (hasShift ? hotKeys[2] : hotKeys[1]);
    let keyCode
    // 更新 electron 后不需要判断 Mac，但 Mac 下中英文有区别，需使用 keyCode 辅助
    if (hasShift) {
        if (key === "-") {
            key = "_";
            keyCode = 189;
        } else if (key === "=") {
            key = "+";
            keyCode = 187;
        } else if (key === ".") {
            key = ">";
            keyCode = 190;
        }
    }
    if (isCtrl(event) && (event.key.toLowerCase() === key.toLowerCase() || event.keyCode === keyCode) && !event.altKey
        && ((!hasShift && !event.shiftKey) || (hasShift && event.shiftKey))) {
        return true;
    }
    return false;
};

