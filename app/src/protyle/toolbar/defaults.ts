const toolbarEntryId = Symbol("toolbarEntryId");

interface IToolbarEntry {
    key: string;
    name: string;
    lang?: string;
    icon?: string;
    separator?: boolean;
}

type TConfigurableToolbarItem = IMenuItem & {
    [toolbarEntryId]?: string;
};

export const TOOLBAR_ENTRY_ROOT_PATH = "editor.toolbar";

export const DESKTOP_TOOLBAR_ENTRIES: IToolbarEntry[] = [{
    key: "block-ref",
    name: "block-ref",
    lang: "ref",
}, {
    key: "a",
    name: "a",
    lang: "link",
}, {
    key: "ai",
    name: "ai",
    lang: "aiEdit",
}, {
    key: "separator_1",
    name: "|",
    separator: true,
}, {
    key: "text",
    name: "text",
    lang: "appearance",
}, {
    key: "strong",
    name: "strong",
    lang: "bold",
}, {
    key: "em",
    name: "em",
    lang: "italic",
}, {
    key: "u",
    name: "u",
    lang: "underline",
}, {
    key: "s",
    name: "s",
    lang: "strike",
}, {
    key: "mark",
    name: "mark",
    lang: "mark",
}, {
    key: "sup",
    name: "sup",
    lang: "sup",
}, {
    key: "sub",
    name: "sub",
    lang: "sub",
}, {
    key: "code",
    name: "code",
    lang: "inline-code",
}, {
    key: "kbd",
    name: "kbd",
    lang: "kbd",
}, {
    key: "tag",
    name: "tag",
    lang: "tag",
}, {
    key: "inline-math",
    name: "inline-math",
    lang: "inline-math",
}, {
    key: "inline-memo",
    name: "inline-memo",
    lang: "memo",
}, {
    key: "separator_2",
    name: "|",
    separator: true,
}, {
    key: "format-painter",
    name: "format-painter",
    lang: "formatPainter",
}, {
    key: "clear",
    name: "clear",
    lang: "clearInline",
    icon: "iconEraser",
}];

const desktopToolbarEntryKeys = new Map(DESKTOP_TOOLBAR_ENTRIES
    .filter((item) => !item.separator)
    .map((item) => [item.name, item.key]));

const toolbarSeparator = (entryId: string): IMenuItem => {
    const item: TConfigurableToolbarItem = {name: "|"};
    item[toolbarEntryId] = entryId;
    return item;
};

export const getDefaultToolbar = (mobile: boolean): Array<string | IMenuItem> => {
    if (mobile) {
        return [
            "block-ref",
            "a",
            "ai",
            "|",
            "text",
            "strong",
            "em",
            "u",
            "clear",
            "|",
            "code",
            "tag",
            "inline-math",
            "inline-memo",
        ];
    }
    return DESKTOP_TOOLBAR_ENTRIES.map((item) => {
        if (item.separator) {
            return toolbarSeparator(item.key);
        }
        if (item.icon) {
            return {name: item.name, icon: item.icon};
        }
        return item.name;
    });
};

export const getToolbarEntryId = (item: IMenuItem) => item.name === "|"
    ? (item as TConfigurableToolbarItem)[toolbarEntryId]
    : desktopToolbarEntryKeys.get(item.name);
