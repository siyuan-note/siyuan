import {matchHotKey} from "../util/hotKey";

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
