export const CUSTOM_EMOJI_BATCH_SIZE = 128;

export type TCustomEmojiGroup = {
    name: string;
    items: IEmojiItem[];
};

export type TCustomEmojiBatch = {
    groups: TCustomEmojiGroup[];
    nextOffset: number;
    hasMore: boolean;
};

export const getEmojiItemMap = (categories: IEmoji[], hideCustom = false) => {
    const emojiMap = new Map<string, IEmojiItem>();
    categories.forEach((category) => {
        if (hideCustom && category.id === "custom") {
            return;
        }
        category.items.forEach((item) => emojiMap.set(item.unicode, item));
    });
    return emojiMap;
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
    categories.forEach((category) => {
        if (hideCustom && category.id === "custom") {
            return;
        }
        category.items.forEach((item) => {
            if ((typeof max === "number" && matchedCount >= max) || !matcher(item)) {
                return;
            }
            if (category.id === "custom") {
                customItems.push(item);
            } else {
                builtInItems.push(item);
            }
            matchedCount++;
        });
    });
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

export const getCustomEmojiBatch = (
    groups: TCustomEmojiGroup[],
    offset: number,
    limit = CUSTOM_EMOJI_BATCH_SIZE,
): TCustomEmojiBatch => {
    const batchGroups: TCustomEmojiGroup[] = [];
    let skipped = 0;
    let remaining = limit;
    let nextOffset = offset;
    let total = 0;

    groups.forEach((group) => {
        total += group.items.length;
        if (remaining === 0 || skipped + group.items.length <= offset) {
            skipped += group.items.length;
            return;
        }
        const groupOffset = Math.max(0, offset - skipped);
        const items = group.items.slice(groupOffset, groupOffset + remaining);
        if (items.length > 0) {
            batchGroups.push({name: group.name, items});
            remaining -= items.length;
            nextOffset += items.length;
        }
        skipped += group.items.length;
    });

    return {
        groups: batchGroups,
        nextOffset,
        hasMore: nextOffset < total,
    };
};
