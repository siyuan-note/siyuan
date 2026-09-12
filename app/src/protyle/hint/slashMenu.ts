import {reorderEntrySlots} from "../../config/entryVisibility/order";

export type TSlashMenuItem = IHintData & {
    entryKey: string;
    showInLite?: boolean;
};

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

// 精简模式仅保留不依赖持久化文档上下文的内置项。
const LITE_SLASH_IDS = new Set([
    "assets", "ref", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6",
    "list", "orderedList", "check", "quote", "tabs", "calloutNote", "calloutTip", "calloutImportant",
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
            (options.canUpload && ["insertAsset", "insertHTMLFile"].includes(item.id)) : item.showInLite === true)) &&
        options.visible(item.entryKey) &&
        !(options.hideConfiguredCreate && item.entryKey === "newFileRef"));
    const filteredItems = options.key === "" ? visibleItems : visibleItems.filter((item) => item.filter?.some((filter) =>
        filter.toLowerCase().includes(options.key.toLowerCase())));
    return normalizeSlashMenuSeparators(filteredItems);
};
