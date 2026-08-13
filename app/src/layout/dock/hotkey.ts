export const updateDockHotkeyData = (
    docks: Config.IUILayoutDockTab[],
    keymap: Config.IKeymapGeneral,
) => {
    docks.forEach((item) => {
        if (!item.hotkeyLangId) {
            return;
        }
        item.hotkey = keymap[item.hotkeyLangId]?.custom || "";
    });
};
