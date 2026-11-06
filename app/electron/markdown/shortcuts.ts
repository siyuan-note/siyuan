import type {Input} from "electron";
import type {SidebarKeymap} from "../../src/util/dockKeymap";
import {matchShortcut} from "../../src/util/shortcut";
import {isDisallowedTextInputHotkey} from "../../src/util/hotKeyPolicy";

const namedKeys: Record<string, string> = {ArrowLeft: "←", ArrowUp: "↑", ArrowRight: "→", ArrowDown: "↓",
    Tab: "⇥", Backspace: "⌫", Delete: "⌦", Enter: "↩", Space: " "};
const punctuation: Record<string, string> = {Semicolon: ";", Equal: "=", Comma: ",", Minus: "-", Period: ".",
    Slash: "/", Backquote: "`", BracketLeft: "[", Backslash: "\\", BracketRight: "]", Quote: "'",
    NumpadMultiply: "*", NumpadAdd: "+", NumpadSubtract: "-", NumpadDecimal: ".", NumpadDivide: "/"};

const inputKey = (input: Input): string => {
    if (/^[a-z0-9]$/i.test(input.key)) return input.key.toUpperCase();
    // Option 与 Shift 可能改变输出字符；Electron 的物理键补齐 DOM 传统键码所代表的主键。
    if (/^Key[A-Z]$/.test(input.code)) return input.code.slice(3);
    if (/^Digit\d$/.test(input.code)) return input.code.slice(5);
    if (/^Numpad\d$/.test(input.code)) return input.code.slice(6);
    return punctuation[input.code] || namedKeys[input.key] || input.key;
};

export const isMarkdownSidebarShortcut = (input: Input, keymap: SidebarKeymap, platform: string): boolean => {
    if (input.type !== "keyDown" || input.isComposing) return false;
    const event = {key: input.key, code: input.code, keyCode: 0, isComposing: false,
        altKey: input.alt, ctrlKey: input.control, metaKey: input.meta, shiftKey: input.shift} as KeyboardEvent;
    return [...keymap.fileTree, ...keymap.outline].some(binding => !isDisallowedTextInputHotkey(binding) &&
        matchShortcut(binding, event, {mac: platform === "darwin", keyCodes: {0: inputKey(input)}}));
};
