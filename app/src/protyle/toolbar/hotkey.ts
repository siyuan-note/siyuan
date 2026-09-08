import {getToolbarEntryId} from "./defaults";
import {getKeymapItem} from "../../util/keymapBindings";

const configuredHotkey = Symbol("configuredHotkey");
type TShortcutToolbarItem = IMenuItem & {[configuredHotkey]?: boolean};

export const markToolbarHotkey = (item: IMenuItem, source: string | IMenuItem) => {
    (item as TShortcutToolbarItem)[configuredHotkey] = typeof source === "string" || source.hotkey === undefined ||
        (source as TShortcutToolbarItem)[configuredHotkey] === true;
};

const inlineKeys: Record<string, string> = {
    "block-ref": "ref", a: "link", strong: "bold", em: "italic", u: "underline", s: "strike",
    code: "inline-code", "inline-memo": "memo", text: "appearance", clear: "clearInline",
    mark: "mark", sup: "sup", sub: "sub", kbd: "kbd", tag: "tag", "inline-math": "inline-math",
};

export const getToolbarHotkey = (item: IMenuItem, keymap: object = window.siyuan.config.keymap) => {
    const id = getToolbarEntryId(item);
    if (id?.startsWith("plugin:")) {
        const parts = id.split(":");
        return getKeymapItem(keymap, ["plugin", decodeURIComponent(parts[1]), decodeURIComponent(parts[2])]) || item.hotkey;
    }
    if (inlineKeys[item.name] && (item as TShortcutToolbarItem)[configuredHotkey]) {
        return getKeymapItem(keymap, ["editor", "insert", inlineKeys[item.name]]) || item.hotkey;
    }
    return item.hotkey;
};
