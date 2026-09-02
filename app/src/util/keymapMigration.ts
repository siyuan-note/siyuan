type TKeymapItem = {
    default: string;
    custom: string;
};

export const migrateEditModeKeymap = (
    keymap: Record<string, TKeymapItem | undefined>,
    defaultHotkey: string,
) => {
    if (keymap["edit-mode"] || (!keymap.preview && !keymap.wysiwyg)) {
        return false;
    }

    const legacyItems = [keymap.preview, keymap.wysiwyg].filter((item): item is TKeymapItem => Boolean(item));
    const customizedItem = legacyItems.find((item) => item.custom !== item.default && Boolean(item.custom));
    const activeItem = legacyItems.find((item) => Boolean(item.custom));
    keymap["edit-mode"] = {
        default: defaultHotkey,
        custom: customizedItem?.custom ?? activeItem?.custom ?? "",
    };
    return true;
};
