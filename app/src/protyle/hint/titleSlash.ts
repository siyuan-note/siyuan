// 标题只能插入已知的内置行级元素，插件和样式命令可能修改整个块。
export const TITLE_INLINE_SLASH_IDS = new Set([
    "ref", "emoji", "link", "bold", "italic", "underline", "strike", "mark", "sup", "sub",
    "inlineCode", "kbd", "tag", "inlineMath",
]);

export const isTitleSlashContext = (protyle: IProtyle) => {
    const focus = getSelection()?.focusNode;
    const element = focus instanceof Element ? focus : focus?.parentElement;
    const title = element?.closest(".callout-title");
    return !!title && title.closest(".protyle-wysiwyg") === protyle.wysiwyg.element;
};
