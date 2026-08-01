type TBlockquoteContext = {
    blockquoteElement: HTMLElement,
    childElement: HTMLElement,
    childElements: HTMLElement[],
};

export const getBlockquoteContext = (nodeElement: HTMLElement, editorElement: HTMLElement): TBlockquoteContext | undefined => {
    let blockquoteElement = nodeElement.parentElement;
    while (blockquoteElement && blockquoteElement !== editorElement &&
        blockquoteElement.getAttribute("data-type") !== "NodeBlockquote") {
        blockquoteElement = blockquoteElement.parentElement;
    }
    if (!blockquoteElement || blockquoteElement === editorElement) {
        return;
    }

    let childElement = nodeElement;
    while (childElement.parentElement && childElement.parentElement !== blockquoteElement) {
        childElement = childElement.parentElement;
    }
    if (childElement.parentElement !== blockquoteElement) {
        return;
    }

    return {
        blockquoteElement,
        childElement,
        childElements: Array.from(blockquoteElement.children).filter((item) =>
            item.hasAttribute("data-node-id")) as HTMLElement[],
    };
};

export const shouldCancelBlockquote = (context: TBlockquoteContext) => {
    return context.childElements.length === 1 && context.childElement.getAttribute("fold") !== "1";
};

export const isBlockquoteMarker = (marker: string) => {
    return /^ {0,3}[>》] ?$/.test(marker);
};
