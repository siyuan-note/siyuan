import {normalizeSlashMenuSeparators} from "../hint/slashMenu";

export const TABLE_CELL_SLASH_IDS = new Set([
    "ref", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "list", "orderedList", "check",
    "quote", "code", "math", "link", "bold", "italic", "underline", "strike", "mark", "sup", "sub", "inlineCode",
    "kbd", "tag", "inlineMath", "emoji", "assets", "newFileRef", "insertAsset", "insertIOSPhotos", "insertImgURL",
    "infoStyle", "successStyle", "warningStyle", "errorStyle", "clearFontStyle",
]);

export const filterTableCellSlashMenuItems = (items: IHintData[]) => normalizeSlashMenuSeparators(
    items.filter(item => item.html === "separator" || TABLE_CELL_SLASH_IDS.has(item.id)));
