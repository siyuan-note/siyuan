export const getHorizontalSuperBlockChild = (blockElement?: Element | null, boundaryElement?: Element) => {
    let currentElement = blockElement;
    while (currentElement?.parentElement && currentElement !== boundaryElement) {
        const parentElement = currentElement.parentElement;
        if (parentElement.getAttribute("data-type") === "NodeSuperBlock" &&
            parentElement.getAttribute("data-sb-layout") === "col") {
            return currentElement.hasAttribute("data-node-id") ? currentElement : undefined;
        }
        currentElement = parentElement;
    }
};
