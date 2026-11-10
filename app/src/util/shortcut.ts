import {getKeymapBindings, IShortcutKeymap, normalizeShortcutKey} from "./keymapBindings";

export const matchShortcut = (hotKey: string | IShortcutKeymap, event: KeyboardEvent,
    platform: {mac: boolean; ios?: boolean; keyCodes: Record<number, string>}): boolean => {
    const {mac, ios, keyCodes} = platform;
    const isNotCtrl = (input: KeyboardEvent) => !input.ctrlKey && !input.metaKey;
    const isOnlyMeta = (input: KeyboardEvent) => mac ? input.metaKey && !input.ctrlKey : input.ctrlKey && !input.metaKey;
    if (typeof hotKey !== "string") {
        return getKeymapBindings(hotKey).some(key => matchShortcut(key, event, platform));
    }
    if (!hotKey) {
        return false;
    }

    hotKey = normalizeShortcutKey(hotKey, mac);
    if (!hotKey) {
        return false;
    }

    // iOS 中文输入法可能将未组词的 Command 或 Option 字母键标记为 229，此时按实际字母匹配。
    let eventKey = event.keyCode === 229 && (event.metaKey || event.altKey) && !event.isComposing &&
        /^[a-z]$/i.test(event.key) && ios ? event.key.toUpperCase() : keyCodes[event.keyCode];
    // Option 可能将字母转换为特殊字符；传统键码不可识别时，仅按字母物理键码兜底。
    if (!eventKey && event.altKey && !event.isComposing && event.key?.length === 1 &&
        /^Key[A-Z]$/.test(event.code) && ios) {
        eventKey = event.code.slice(3);
    }

    // []
    if (hotKey.indexOf("⇧") === -1 && hotKey.indexOf("⌘") === -1 && hotKey.indexOf("⌥") === -1 && hotKey.indexOf("⌃") === -1) {
        if (isNotCtrl(event) && !event.altKey && !event.shiftKey && hotKey === eventKey) {
            return true;
        }
        return false;
    }

    // 将快捷键字符串拆分为 多个修饰键 + 一个主键，例如 ⌥⇧F10 → ["⌥", "⇧", "F10"]
    const hotKeys: string[] = [];
    let hotKeyIndex = 0;
    while (hotKeyIndex < hotKey.length && "⌃⌥⇧⌘".includes(hotKey[hotKeyIndex])) {
        hotKeys.push(hotKey[hotKeyIndex]);
        hotKeyIndex++;
    }
    const mainKey = hotKey.slice(hotKeyIndex);
    if (mainKey) {
        hotKeys.push(mainKey);
    }

    // 是否匹配 ⇧[]
    if (hotKey.startsWith("⇧") && hotKeys.length === 2) {
        if (isNotCtrl(event) && !event.altKey && event.shiftKey && hotKeys[1] === eventKey) {
            return true;
        }
        return false;
    }

    if (hotKey.startsWith("⌥")) {
        let keyCode = hotKeys.length === 3 ? hotKeys[2] : hotKeys[1];
        if (hotKeys.length === 4) {
            keyCode = hotKeys[3];
        }
        const isMatchKey = keyCode === eventKey;
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
        if (!mac) {
            return false;
        }
        let keyCode = hotKeys.length === 3 ? hotKeys[2] : hotKeys[1];
        if (hotKeys.length === 4) {
            keyCode = hotKeys[3];
        } else if (hotKeys.length === 5) {
            keyCode = hotKeys[4];
        }

        const isMatchKey = keyCode === eventKey;
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
        return (hasShift ? hotKeys[2] : hotKeys[1]) === eventKey;
    }
    return false;
};

export const formatShortcut = (hotkey: string, mac: boolean) => {
    if (!hotkey) {
        return hotkey;
    }
    if (mac) {
        // 为 Return 字符指定文本呈现，避免 macOS 使用彩色 emoji 字形。
        return hotkey.replace(/↩(?!\uFE0E)/g, "↩\uFE0E");
    }
    const keys = [];
    if ((hotkey.indexOf("⌘") > -1 || hotkey.indexOf("⌃") > -1)) keys.push("Ctrl");
    if (hotkey.indexOf("⇧") > -1) keys.push("Shift");
    if (hotkey.indexOf("⌥") > -1) keys.push("Alt");

    // 不能去最后一个，需匹配 F2
    const lastKey = hotkey.replace(/[⌘⇧⌥⌃]/g, "");
    if (lastKey) {
        keys.push({
            "⇥": "Tab",
            "⌫": "Backspace",
            "⌦": "Delete",
            "↩": "Enter"
        }[lastKey] || lastKey);
    }
    return keys.join("+");
};

