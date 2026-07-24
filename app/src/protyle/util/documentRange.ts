export const updateDocumentBottomEof = (wysiwygElement: HTMLElement) => {
    wysiwygElement.toggleAttribute(
        "data-bottom-eof",
        wysiwygElement.lastElementChild?.getAttribute("data-eof") === "2"
    );
};
