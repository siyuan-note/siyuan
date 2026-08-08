export const updateDocumentBottomEof = (wysiwygElement: HTMLElement, preserveCurrent = false) => {
    if (preserveCurrent && wysiwygElement.hasAttribute("data-bottom-eof")) {
        return;
    }
    wysiwygElement.toggleAttribute(
        "data-bottom-eof",
        wysiwygElement.lastElementChild?.getAttribute("data-eof") === "2"
    );
};

export const hasUnloadedDocumentBlocks = (wysiwygElement: HTMLElement, dynamicLoad: boolean) => {
    if (!dynamicLoad) {
        return false;
    }
    const firstElement = wysiwygElement.firstElementChild;
    const topEof = firstElement?.getAttribute("data-eof") === "1" ||
        firstElement?.getAttribute("data-node-index") === "0";
    return !topEof || !wysiwygElement.hasAttribute("data-bottom-eof");
};
