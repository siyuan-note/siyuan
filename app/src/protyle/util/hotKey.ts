import {isMac, isNotCtrl, isOnlyMeta} from "./compatibility";
import {Constants} from "../../constants";

// 是否匹配辅助键 ⌃⌥⇧⌘
export const matchAuxiliaryHotKey = (hotKey: string, event: KeyboardEvent) => {
    if (hotKey.includes("⌃")) {
        if (!event.ctrlKey) {
            return false;
        }
    } else {
        if (isMac() ? event.ctrlKey : (hotKey.includes("⌘") ? !event.ctrlKey : event.ctrlKey)) {
            return false;
        }
    }
    if (hotKey.includes("⌥")) {
        if (!event.altKey) {
            return false;
        }
    } else {
        if (event.altKey) {
            return false;
        }
    }
    if (hotKey.includes("⇧")) {
        if (!event.shiftKey) {
            return false;
        }
    } else {
        if (event.shiftKey) {
            return false;
        }
    }
    if (hotKey.includes("⌘")) {
        if (isMac() ? !event.metaKey : !event.ctrlKey) {
            return false;
        }
    } else {
        if (isMac() ? event.metaKey : (hotKey.includes("⌃") ? !event.ctrlKey : event.ctrlKey)) {
            return false;
        }
    }
    return true;
};

const replaceDirect = (hotKey: string, keyCode: string) => {
    const hotKeys = hotKey.replace(keyCode, Constants.ZWSP).split("");
    hotKeys.forEach((item, index) => {
        if (item === Constants.ZWSP) {
            hotKeys[index] = keyCode;
        }
    });
    return hotKeys;
};

export const matchHotKey = (hotKey: string, event: KeyboardEvent) => {
    if (!hotKey) {
        return false;
    }

    // https://github.com/siyuan-note/siyuan/issues/9770
    if (hotKey.startsWith("⌃") && !isMac()) {
        if (hotKey === "⌃D") {
            // https://github.com/siyuan-note/siyuan/issues/9841
            return false;
        }
        hotKey = hotKey.replace("⌘", "").replace("⌃", "⌘")
            .replace("⌘⇧", "⇧⌘")
            .replace("⌘⌥⇧", "⌥⇧⌘")
            .replace("⌘⌥", "⌥⌘");
    }

    // []
    if (hotKey.indexOf("⇧") === -1 && hotKey.indexOf("⌘") === -1 && hotKey.indexOf("⌥") === -1 && hotKey.indexOf("⌃") === -1) {
        if (isNotCtrl(event) && !event.altKey && !event.shiftKey && hotKey === Constants.KEYCODELIST[event.keyCode]) {
            return true;
        }
        return false;
    }

    let hotKeys = hotKey.split("");
    if (hotKey.indexOf("F") > -1) {
        hotKeys.forEach((item, index) => {
            if (item === "F") {
                // F1-F12
                hotKeys[index] = "F" + hotKeys.splice(index + 1, 1);
                if (hotKeys[index + 1]) {
                    hotKeys[index + 1] += hotKeys.splice(index + 1, 1);
                }
            }
        });
    } else if (hotKey.indexOf("PageUp") > -1) {
        hotKeys = replaceDirect(hotKey, "PageUp");
    } else if (hotKey.indexOf("PageDown") > -1) {
        hotKeys = replaceDirect(hotKey, "PageDown");
    } else if (hotKey.indexOf("Home") > -1) {
        hotKeys = replaceDirect(hotKey, "Home");
    } else if (hotKey.indexOf("End") > -1) {
        hotKeys = replaceDirect(hotKey, "End");
    }

    // 是否匹配 ⇧[]
    if (hotKey.startsWith("⇧") && hotKeys.length === 2) {
        if (isNotCtrl(event) && !event.altKey && event.shiftKey && hotKeys[1] === Constants.KEYCODELIST[event.keyCode]) {
            return true;
        }
        return false;
    }

    if (hotKey.startsWith("⌥")) {
        let keyCode = hotKeys.length === 3 ? hotKeys[2] : hotKeys[1];
        if (hotKeys.length === 4) {
            keyCode = hotKeys[3];
        }
        const isMatchKey = keyCode === Constants.KEYCODELIST[event.keyCode];
        // 是否匹配 ⌥[] / ⌥⌘[]
        if (isMatchKey && event.altKey && !event.shiftKey && hotKeys.length < 4 &&
            (hotKeys.length === 3 ? (isOnlyMeta(event) && hotKey.startsWith("⌥⌘")) : isNotCtrl(event))) {
            return true;
        }
        // ⌥⇧⌘[]
        if (isMatchKey && hotKey.startsWith("⌥⇧⌘") && hotKeys.length === 4 &&
            event.altKey && event.shiftKey && isOnlyMeta(event)) {
            return true;
        }
        // ⌥⇧[]
        if (isMatchKey && hotKey.startsWith("⌥⇧") && hotKeys.length === 3 &&
            event.altKey && event.shiftKey && isNotCtrl(event)) {
            return true;
        }
        return false;
    }

    // 是否匹配 ⌃[] / ⌃⌘[] / ⌃⌥[] / ⌃⇧[]/ ⌃⌥⇧[]
    if (hotKey.startsWith("⌃")) {
        if (!isMac()) {
            return false;
        }
        let keyCode = hotKeys.length === 3 ? hotKeys[2] : hotKeys[1];
        if (hotKeys.length === 4) {
            keyCode = hotKeys[3];
        } else if (hotKeys.length === 5) {
            keyCode = hotKeys[4];
        }

        const isMatchKey = keyCode === Constants.KEYCODELIST[event.keyCode];
        // 是否匹配 ⌃[] / ⌃⌘[]
        if (isMatchKey && event.ctrlKey && !event.altKey && !event.shiftKey && hotKeys.length < 4 &&
            (hotKeys.length === 3 ? (event.metaKey && hotKey.startsWith("⌃⌘")) : !event.metaKey)) {
            return true;
        }
        // ⌃⇧[]
        if (isMatchKey && hotKey.startsWith("⌃⇧") && hotKeys.length === 3 &&
            event.ctrlKey && !event.altKey && event.shiftKey && !event.metaKey) {
            return true;
        }
        // ⌃⌥[]
        if (isMatchKey && hotKey.startsWith("⌃⌥") && hotKeys.length === 3 &&
            event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey) {
            return true;
        }
        // ⌃⌥⇧[] / ⌃⌥⌘[] / ⌃⇧⌘[]
        if (isMatchKey && hotKeys.length === 4 && event.ctrlKey &&
            (
                (hotKey.startsWith("⌃⌥⇧") && event.shiftKey && !event.metaKey && event.altKey) ||
                (hotKey.startsWith("⌃⌥⌘") && !event.shiftKey && event.metaKey && event.altKey) ||
                (hotKey.startsWith("⌃⇧⌘") && event.shiftKey && event.metaKey && !event.altKey)
            )
        ) {
            return true;
        }

        // ⌃⌥⇧⌘[]
        if (isMatchKey && hotKeys.length === 5 && event.ctrlKey && event.shiftKey && event.metaKey && event.altKey) {
            return true;
        }
        return false;
    }

    // 是否匹配 ⇧⌘[] / ⌘[]
    const hasShift = hotKeys.length > 2 && (hotKeys[0] === "⇧");
    if (isOnlyMeta(event) && !event.altKey && ((!hasShift && !event.shiftKey) || (hasShift && event.shiftKey))) {
        return (hasShift ? hotKeys[2] : hotKeys[1]) === Constants.KEYCODELIST[event.keyCode];
    }
    return false;
};

export const isIncludesHotKey = (hotKey: string) => {
    let isInclude = false;
    Object.keys(window.siyuan.config.keymap).find(key => {
        const item = window.siyuan.config.keymap[key as "editor"];
        Object.keys(item).find(key2 => {
            const item2 = item[key2 as "general"];
            if (typeof item2.custom === "string") {
                if (item2.custom === hotKey) {
                    isInclude = true;
                    return true;
                }
            } else {
                Object.keys(item2).forEach(key3 => {
                    const item3: Config.IKey = item2[key3];
                    if (item3.custom === hotKey) {
                        isInclude = true;
                        return true;
                    }
                });
                if (isInclude) {
                    return true;
                }
            }
        });

        if (isInclude) {
            return true;
        }
    });

    return isInclude;
};

export const updateControlAlt = () => {
    if (!window.siyuan.config.keymap.general) {
        return;
    }
    Object.keys(window.siyuan.config.keymap.general).forEach(key => {
        if (["fileTree", "outline", "bookmark", "tag", "dailyNote", "inbox", "backlinks",
            "graphView", "globalGraph", "riffCard"].includes(key)) {
            if (navigator.platform.toUpperCase().indexOf("MAC") > -1) {
                window.siyuan.config.keymap.general[key].default = window.siyuan.config.keymap.general[key].default.replace("⌥", "⌃");
                if (window.siyuan.config.keymap.general[key].default === window.siyuan.config.keymap.general[key].custom) {
                    window.siyuan.config.keymap.general[key].custom = window.siyuan.config.keymap.general[key].default.replace("⌥", "⌃");
                }
            } else {
                window.siyuan.config.keymap.general[key].default = window.siyuan.config.keymap.general[key].default.replace("⌃", "⌥");
                if (window.siyuan.config.keymap.general[key].default === window.siyuan.config.keymap.general[key].custom) {
                    window.siyuan.config.keymap.general[key].custom = window.siyuan.config.keymap.general[key].default.replace("⌃", "⌥");
                }
            }
        }
    });
};
