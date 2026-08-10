export const NESTED_LIST_PASTE_MARKER = "<!--data-siyuan-paste='nested-list'-->";

export const isNestedListCrossBlockSelection = (startListItem?: Element | false, endListItem?: Element | false) => {
    return !!startListItem && !!endListItem && startListItem !== endListItem && startListItem.contains(endListItem);
};

export const extractCrossBlockPasteContext = (html: string) => ({
    nestedList: html.includes(NESTED_LIST_PASTE_MARKER),
    html: html.replaceAll(NESTED_LIST_PASTE_MARKER, ""),
});

export const shouldPreservePastedBlockStructure = (elements: ArrayLike<Element>) => {
    const rootElements = Array.from(elements);
    return rootElements.some(item => item.classList.contains("protyle-wysiwyg--select")) ||
        rootElements[0]?.getAttribute("data-type") === "NodeHeading";
};
