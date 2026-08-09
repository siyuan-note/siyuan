export const updateDocumentBottomEof = (wysiwygElement: HTMLElement, preserveCurrent = false) => {
    if (preserveCurrent && wysiwygElement.hasAttribute("data-bottom-eof")) {
        return;
    }
    wysiwygElement.toggleAttribute(
        "data-bottom-eof",
        wysiwygElement.lastElementChild?.getAttribute("data-eof") === "2"
    );
};

export const isDocumentBoundaryLoaded = (wysiwygElement: HTMLElement, position: "before" | "after") => {
    if (position === "after") {
        return wysiwygElement.hasAttribute("data-bottom-eof");
    }
    const firstElement = wysiwygElement.firstElementChild;
    return firstElement?.getAttribute("data-eof") === "1" ||
        firstElement?.getAttribute("data-node-index") === "0";
};

export const hasUnloadedDocumentBlocks = (wysiwygElement: HTMLElement, dynamicLoad: boolean) => {
    if (!dynamicLoad) {
        return false;
    }
    return !isDocumentBoundaryLoaded(wysiwygElement, "before") ||
        !isDocumentBoundaryLoaded(wysiwygElement, "after");
};
