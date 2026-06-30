import {updateHotkeyTip} from "../../protyle/util/compatibility";

export const getDockHotkey = (dock: Config.IUILayoutDockTab): string => {
    // 内置 dock 快捷键
    if (dock.hotkeyLangId) {
        return window.siyuan.config.keymap.general[dock.hotkeyLangId]?.custom ?? "";
    }
    // 插件 dock 快捷键
    for (const plugin of window.siyuan.ws.app.plugins) {
        const keymap = window.siyuan.config.keymap.plugin[plugin.name]?.[dock.type];
        if (keymap) {
            return keymap.custom ?? "";
        }
    }
    return "";
};

export const genDockItemAriaLabel = (title: string, hotkey: string): string => {
    const hotkeyTip = hotkey ? updateHotkeyTip(hotkey) : "";
    return `<span style='white-space:pre'>${title} ${hotkeyTip}${window.siyuan.languages.dockTip}</span>`;
};

export const updateDockHotkeyDom = (selector: string, hotkey: string) => {
    document.querySelectorAll(selector).forEach((el) => {
        const title = el.getAttribute("data-title") || "";
        el.setAttribute("aria-label", genDockItemAriaLabel(title, hotkey));
    });
};
