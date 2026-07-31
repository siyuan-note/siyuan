export const updateDocumentBottomEof = (wysiwygElement: HTMLElement, preserveCurrent = false) => {
    if (preserveCurrent && wysiwygElement.hasAttribute("data-bottom-eof")) {
        return;
    }
    wysiwygElement.toggleAttribute(
        "data-bottom-eof",
        wysiwygElement.lastElementChild?.getAttribute("data-eof") === "2"
    );
};
