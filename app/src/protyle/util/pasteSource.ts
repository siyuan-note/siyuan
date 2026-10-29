export const NESTED_LIST_PASTE_MARKER = "<!--data-siyuan-paste='nested-list'-->";

export const serializePastedBlockDOM = (container: Pick<HTMLElement, "innerHTML">) => container.innerHTML;

export const getSinglePastedBlockRefID = (lute: Lute, html: string, text: string): string | undefined => {
    if (!html && !text.trimStart().startsWith("((")) {
        return;
    }
    const template = document.createElement("template");
    template.innerHTML = html || lute.Md2BlockDOM(text);
    const meaningfulNodes = (root: ParentNode) => Array.from(root.childNodes).filter(node =>
        node.nodeType !== 3 || node.textContent.replace(/\u200b/g, "").trim() !== "");
    let nodes = meaningfulNodes(template.content);
    if (nodes.length === 1 && nodes[0].nodeType === 1 &&
        (nodes[0] as Element).getAttribute("data-type") === "NodeParagraph") {
        const editableElement = (nodes[0] as Element).querySelector('[contenteditable="true"]');
        if (!editableElement) {
            return;
        }
        nodes = meaningfulNodes(editableElement);
    }
    if (nodes.length !== 1 || nodes[0].nodeType !== 1) {
        return;
    }
    const element = nodes[0] as HTMLElement;
    if (element.tagName === "SPAN" && (element.dataset.type || "").split(" ").includes("block-ref") &&
        /^[0-9]{14}-[a-z0-9]{7}$/.test(element.dataset.id || "") &&
        ["s", "d"].includes(element.dataset.subtype) && !element.querySelector('[data-type~="block-ref"]')) {
        return element.dataset.id;
    }
};

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
