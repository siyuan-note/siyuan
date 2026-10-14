import {reorderEntrySlots} from "../../config/entryVisibility/order";

// 块标菜单与配置目录共用默认顺序，附加操作保留在对应类型附近。
const turnIntoOrder = [
    "paragraph",
    "heading1", "heading2", "heading3", "heading4", "heading5", "heading6",
    "removeList", "list", "orderedList", "check", "listMindmap", "includeSublists",
    "quote", "callout",
    "calloutNote", "calloutTip", "calloutImportant", "calloutWarning", "calloutCaution", "calloutCustom",
    "tabs", "superBlock", "code", "table", "line", "math",
];

export const orderGutterTurnIntoItems = <T>(items: T[], getKey: (item: T) => string | undefined) =>
    reorderEntrySlots(items, turnIntoOrder, getKey);
