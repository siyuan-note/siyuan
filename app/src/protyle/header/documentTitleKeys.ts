import {matchHotKey} from "../util/hotKey";
import {copyTextByType} from "../toolbar/util";

const inlineInsertKeys = new Set([
    "appearance", "bold", "clearInline", "inline-code", "inline-math", "italic", "kbd", "link", "mark",
    "memo", "ref", "strike", "sub", "sup", "tag", "underline",
]);
const blockGeneralKeys = [
    "insertBefore", "insertAfter", "insertSuperBlockLeft", "insertSuperBlockRight", "moveToUp", "moveToDown",
    "vLayout", "hLayout", "newNameFile", "newNameSettingFile", "newContentFile", "ai", "aiWriting", "attr",
    "alignLeft", "alignCenter", "alignRight", "rtl", "ltr", "collapse", "expand", "foldChildHeadings",
    "foldSiblingHeadings", "foldRecursive", "expandUp", "expandDown", "rename",
];

// 行级编辑器复用原生快捷键，但不能把唯一的临时载体转换、删除或移动为正文块。
export const isDocumentTitleBlockHotkey = (event: KeyboardEvent) => {
    const editor = window.siyuan.config.keymap.editor;
    const shortcuts = [
        ...Object.values(editor.heading), ...Object.values(editor.list), ...Object.values(editor.table),
        ...Object.entries(editor.insert).filter(([name]) => !inlineInsertKeys.has(name)).map(([, key]) => key),
        ...blockGeneralKeys.map(name => editor.general[name]),
    ];
    return shortcuts.some(shortcut => shortcut && matchHotKey(shortcut, event));
};

export const copyDocumentTitleTarget = (event: KeyboardEvent, id: string) => {
    const general = window.siyuan.config.keymap.editor.general;
    const shortcuts: [typeof general.copyBlockRef, "ref" | "blockEmbed" | "protocol" | "protocolMd" | "id" | "hPath"][] = [
        [general.copyBlockRef, "ref"], [general.copyBlockEmbed, "blockEmbed"],
        [general.copyProtocol, "protocol"], [general.copyProtocolInMd, "protocolMd"],
        [general.copyID, "id"], [general.copyHPath, "hPath"],
    ];
    const shortcut = shortcuts.find(([key]) => key && matchHotKey(key, event));
    if (!shortcut) {
        return false;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    void copyTextByType([id], shortcut[1]);
    return true;
};
