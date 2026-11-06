import {matchShortcut} from "../../util/shortcut";
import {isInIOS, isMac} from "./compatibility";
import {Constants} from "../../constants";
import {getKeymapBindings, IShortcutKeymap, visitKeymapItems} from "../../util/keymapBindings";

// 是否匹配辅助键 ⌃⌥⇧⌘
export const matchAuxiliaryHotKey = (hotKey: string | IShortcutKeymap, event: KeyboardEvent): boolean => {
    if (typeof hotKey !== "string") {
        return getKeymapBindings(hotKey).some(key => matchAuxiliaryHotKey(key, event));
    }
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

export const matchHotKey = (hotKey: string | IShortcutKeymap, event: KeyboardEvent): boolean =>
    matchShortcut(hotKey, event, {mac: isMac(), ios: Boolean(isInIOS()), keyCodes: Constants.KEYCODELIST});

export const isIncludesHotKey = (hotKey: string) => {
    let included = false;
    visitKeymapItems(window.siyuan.config.keymap, item => {
        if (getKeymapBindings(item).includes(hotKey)) {
            included = true;
        }
    });
    return included;
};
