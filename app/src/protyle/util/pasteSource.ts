export const hasBlockSelectionPasteMarker = (elements: ArrayLike<Element>) => {
    return Array.from(elements).some(item => item.classList.contains("protyle-wysiwyg--select"));
};
