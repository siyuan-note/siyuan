import {reorderEntrySlots} from "../../config/entryVisibility/order";

export type TSlashMenuItem = IHintData & {
    entryKey: string;
    showInLite?: boolean;
    frequentEligible?: boolean;
};

export const getSlashEntryKey = (item: IHintData): string =>
    "entryKey" in item && typeof item.entryKey === "string" ? item.entryKey : "";

interface IResolveSlashMenuOptions {
    enabled: boolean;
    hideConfiguredCreate: boolean;
    key: string;
    order: string[];
    visible: (entryKey: string) => boolean;
    lite?: boolean;
    canUpload?: boolean;
}

const isSeparator = (item?: TSlashMenuItem) => item?.html === "separator";

// 命中质量，数字越小越靠前：与输入完全相等、以输入开头、在中间包含
const MATCH_EXACT = 0;
const MATCH_PREFIX = 1;
const MATCH_CONTAINS = 2;
const MATCH_NONE = 3;

// 命中位置决定候选顺序，避免「database」这类中间包含的别名盖过「tabs」这类前缀命中
const getSlashMatchRank = (item: TSlashMenuItem, key: string) => {
    let rank = MATCH_NONE;
    (item.filter || []).forEach((filter) => {
        const value = filter.toLowerCase();
        const index = value.indexOf(key);
        if (index === -1) {
            return;
        }
        let current = MATCH_CONTAINS;
        if (index === 0) {
            current = value === key ? MATCH_EXACT : MATCH_PREFIX;
        }
        rank = Math.min(rank, current);
    });
    return rank;
};

// 精简模式仅保留不依赖持久化文档上下文的内置项。
const LITE_SLASH_IDS = new Set([
    "assets", "ref", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6",
    "list", "orderedList", "check", "quote", "horizontalSuperBlock", "verticalSuperBlock", "tabs", "calloutNote", "calloutTip", "calloutImportant",
    "calloutWarning", "calloutCaution", "code", "table", "line", "math", "html",
    "emoji", "link", "bold", "italic", "underline", "strike", "mark", "sup", "sub", "inlineCode",
    "kbd", "tag", "inlineMath", "insertIframeURL", "insertImgURL", "insertVideoURL", "insertAudioURL",
    "staff", "chart", "flowChart", "graph", "mermaid", "mindmap", "UML",
    "infoStyle", "successStyle", "warningStyle", "errorStyle", "clearFontStyle",
]);

export const normalizeSlashMenuSeparators = (items: TSlashMenuItem[]) => {
    const result: TSlashMenuItem[] = [];
    items.forEach((item) => {
        if (isSeparator(item)) {
            if (result.length > 0 && !isSeparator(result[result.length - 1])) {
                result.push(item);
            }
            return;
        }
        result.push(item);
    });
    if (isSeparator(result[result.length - 1])) {
        result.pop();
    }
    return result;
};

export const resolveSlashMenuItems = (items: TSlashMenuItem[], options: IResolveSlashMenuOptions) => {
    if (!options.enabled) {
        return [];
    }
    const entryKeys = new Set<string>();
    const uniqueItems = items.filter((item) => {
        if (entryKeys.has(item.entryKey)) {
            return false;
        }
        entryKeys.add(item.entryKey);
        return true;
    });
    const orderedItems = reorderEntrySlots(uniqueItems, options.order, (item) => item.entryKey);
    const visibleItems = orderedItems.filter((item) => (!options.lite || isSeparator(item) ||
        (item.entryKey === item.id ? LITE_SLASH_IDS.has(item.id) ||
            (options.canUpload && ["insertAsset", "insertIOSPhotos", "insertHTMLFile"].includes(item.id)) : item.showInLite === true)) &&
        options.visible(item.entryKey) &&
        !(options.hideConfiguredCreate && item.entryKey === "newFileRef"));
    const filteredItems = options.key === "" ? visibleItems : visibleItems.map((item, index) => ({
        item,
        index,
        rank: getSlashMatchRank(item, options.key.toLowerCase()),
    })).filter((entry) => entry.rank < MATCH_NONE).sort((first, second) =>
        first.rank - second.rank || first.index - second.index).map((entry) => entry.item);
    return normalizeSlashMenuSeparators(filteredItems);
};
