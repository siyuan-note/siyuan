export const EMOJI_VIRTUAL_CHUNK_ROWS = 8;

export type TCustomEmojiGroup = {
    name: string;
    items: IEmojiItem[];
};

export type TRandomEmojiScope = "all" | "builtIn" | "custom";

export type TEmojiPanelPageMode = "common" | "custom" | "search" | "";
export type TEmojiPanelResizeAction = "none" | "render" | "refresh";

export const getEmojiPanelResizeAction = (
    pageMode: TEmojiPanelPageMode,
    columnCount: number,
    nextColumnCount: number,
): TEmojiPanelResizeAction => {
    if (pageMode !== "common" && pageMode !== "custom") {
        return "none";
    }
    if (columnCount !== nextColumnCount) {
        return "render";
    }
    return pageMode === "common" ? "refresh" : "none";
};

export const getRandomEmojiCategories = (categories: IEmoji[], scope: TRandomEmojiScope) => {
    return categories.filter((category) => category.items.length > 0 &&
        (scope === "all" || (category.id === "custom") === (scope === "custom")));
};

const emojiItemMapCache = new WeakMap<IEmoji[], {
    all: Map<string, IEmojiItem>;
    builtIn: Map<string, IEmojiItem>;
}>();

export const getEmojiItemMap = (categories: IEmoji[], hideCustom = false) => {
    const cached = emojiItemMapCache.get(categories);
    if (cached) {
        return hideCustom ? cached.builtIn : cached.all;
    }
    const all = new Map<string, IEmojiItem>();
    const builtIn = new Map<string, IEmojiItem>();
    categories.forEach((category) => {
        category.items.forEach((item) => {
            all.set(item.unicode, item);
            if (category.id !== "custom") {
                builtIn.set(item.unicode, item);
            }
        });
    });
    emojiItemMapCache.set(categories, {all, builtIn});
    return hideCustom ? builtIn : all;
};

export const collectEmojiMatches = (
    categories: IEmoji[],
    matcher: (item: IEmojiItem) => boolean,
    max?: number,
    hideCustom = false,
) => {
    const customItems: IEmojiItem[] = [];
    const builtInItems: IEmojiItem[] = [];
    let matchedCount = 0;
    outer:
    for (const category of categories) {
        if (hideCustom && category.id === "custom") {
            continue;
        }
        for (const item of category.items) {
            if (typeof max === "number" && matchedCount >= max) {
                break outer;
            }
            if (!matcher(item)) {
                continue;
            }
            if (category.id === "custom") {
                customItems.push(item);
            } else {
                builtInItems.push(item);
            }
            matchedCount++;
        }
    }
    return {customItems, builtInItems};
};

const getCustomEmojiGroupName = (unicode: string) => {
    const separatorIndex = unicode.indexOf("/");
    return separatorIndex > -1 ? unicode.substring(0, separatorIndex) : "";
};

export const groupCustomEmojiItems = (items: IEmojiItem[]) => {
    const rootItems: IEmojiItem[] = [];
    const folderGroups = new Map<string, IEmojiItem[]>();
    items.forEach((item) => {
        const groupName = getCustomEmojiGroupName(item.unicode);
        if (!groupName) {
            rootItems.push(item);
            return;
        }
        const groupItems = folderGroups.get(groupName) || [];
        groupItems.push(item);
        folderGroups.set(groupName, groupItems);
    });

    const groups: TCustomEmojiGroup[] = [];
    if (rootItems.length > 0) {
        groups.push({name: "", items: rootItems});
    }
    folderGroups.forEach((groupItems, name) => {
        groups.push({name, items: groupItems});
    });
    return groups;
};

export const getEmojiVirtualChunks = (
    items: IEmojiItem[],
    columnCount: number,
    rowCount = EMOJI_VIRTUAL_CHUNK_ROWS,
) => {
    const chunks: IEmojiItem[][] = [];
    const chunkSize = Math.max(1, columnCount) * Math.max(1, rowCount);
    for (let offset = 0; offset < items.length; offset += chunkSize) {
        chunks.push(items.slice(offset, offset + chunkSize));
    }
    return chunks;
};

export const getActiveEmojiCategory = (
    offsets: {id: string, top: number}[],
    scrollTop: number,
    isBottom = false,
) => {
    if (offsets.length === 0) {
        return "";
    }
    if (isBottom) {
        return offsets[offsets.length - 1].id;
    }
    let currentID = offsets[0].id;
    for (const item of offsets) {
        if (item.top > scrollTop + 1) {
            break;
        }
        currentID = item.id;
    }
    return currentID;
};
