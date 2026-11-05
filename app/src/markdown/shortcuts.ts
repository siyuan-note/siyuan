import {Constants} from "../constants";
import {getSidebarKeymap, readSidebarKeymap, SidebarKeymap} from "../util/dockKeymap";
import {formatShortcut, matchShortcut} from "../util/shortcut";
import {isDisallowedTextInputHotkey} from "../util/hotKeyPolicy";

export const createMarkdownSidebarShortcuts = (options: {
    platform: string;
    keymap?: SidebarKeymap;
    canToggle(key: keyof SidebarKeymap): boolean;
    isComposing(): boolean;
    toggle(key: keyof SidebarKeymap): void;
}) => {
    const platform = {mac: ["darwin", "ios"].includes(options.platform), ios: options.platform === "ios",
        keyCodes: Constants.KEYCODELIST};
    let keymap = readSidebarKeymap(options.keymap) || getSidebarKeymap(undefined, options.platform);
    const bindings = (key: keyof SidebarKeymap) => keymap[key].filter(binding => !isDisallowedTextInputHotkey(binding));
    return {
        update(value: SidebarKeymap) {
            const next = readSidebarKeymap(value);
            if (next) keymap = next;
        },
        label(key: keyof SidebarKeymap) {
            return bindings(key).map(binding => formatShortcut(binding, platform.mac)).join(" / ");
        },
        handle(event: KeyboardEvent) {
            if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || options.isComposing()) return false;
            const key = (["fileTree", "outline"] as const).find(candidate => options.canToggle(candidate) &&
                bindings(candidate).some(binding => matchShortcut(binding, event, platform)));
            if (!key) return false;
            event.preventDefault();
            event.stopImmediatePropagation();
            // 长按快捷键不重复开合，也不把后续按键交给编辑器或菜单。
            if (!event.repeat) options.toggle(key);
            return true;
        },
    };
};
