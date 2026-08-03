export const shouldPreservePastedBlockStructure = (elements: ArrayLike<Element>) => {
    const rootElements = Array.from(elements);
    return rootElements.some(item => item.classList.contains("protyle-wysiwyg--select")) ||
        rootElements[0]?.getAttribute("data-type") === "NodeHeading";
};
