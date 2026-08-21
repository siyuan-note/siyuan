type TDragSelectRect = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

export const getBlockDragSelectContentBounds = (editorLeft: number, editorRight: number,
                                                 paddingLeft: string, paddingRight: string) => {
    const parsedPaddingLeft = parseFloat(paddingLeft);
    const parsedPaddingRight = parseFloat(paddingRight);
    return {
        left: editorLeft + (Number.isNaN(parsedPaddingLeft) ? 24 : parsedPaddingLeft) + 1,
        right: editorRight - (Number.isNaN(parsedPaddingRight) ? 16 : parsedPaddingRight) - 2,
    };
};

type TResolveDragSelectBlockOptions = {
    x: number,
    top: number,
    bottom: number,
    elementFromPoint: (x: number, y: number) => Element | null,
    getBlock: (element: Element) => Element | false,
    isContainerSurface: (element: Element) => boolean,
    fallbackBlock?: Element | false,
};

export const getBlockDragSelectBlock = (element: Element, boundaryElement: Element,
                                        getBlock: TResolveDragSelectBlockOptions["getBlock"],
                                        isContainerBlock: (element: Element) => boolean,
                                        isListItem: (element: Element) => boolean) => {
    const block = getBlock(element);
    if (!block || isContainerBlock(block)) {
        return block;
    }
    let parentElement = block.parentElement;
    while (parentElement && parentElement !== boundaryElement) {
        if (isContainerBlock(parentElement)) {
            if (!isListItem(parentElement)) {
                return block;
            }
            // 列表项的首个直属块代表列表项主内容，其他子块可单独划选。
            for (let i = 0; i < parentElement.children.length; i++) {
                const childElement = parentElement.children[i];
                if (getBlock(childElement) === childElement) {
                    return childElement === block ? parentElement : block;
                }
            }
            return parentElement;
        }
        parentElement = parentElement.parentElement;
    }
    return block;
};

export const getBlockDragSelectProbeX = (startX: number, selectRect: TDragSelectRect,
                                         contentLeft: number, contentRight: number) => {
    let probeX = selectRect.left;
    if (startX < contentLeft) {
        probeX = selectRect.right;
    } else if (startX > contentRight) {
        probeX = selectRect.left;
    }
    return Math.max(contentLeft, Math.min(probeX, contentRight));
};

export const isBlockDragSelectBottomReached = (selectBottom: number, containerBottom: number,
                                               lastChildBottom: number) =>
    selectBottom > Math.min(containerBottom, lastChildBottom);

export const isBlockDragSelectTopReached = (selectTop: number, containerTop: number, firstChildTop: number) =>
    selectTop < Math.max(containerTop, firstChildTop);

export const clampBlockDragSelectY = (clientY: number, viewportTop: number, viewportBottom: number,
                                      wysiwygTop: number, wysiwygBottom: number) => {
    const top = Math.max(viewportTop, wysiwygTop);
    const bottom = Math.min(viewportBottom, wysiwygBottom);
    return Math.max(top, Math.min(clientY, bottom));
};

const getDirectDescendantBlock = (containerBlock: Element, block: Element,
                                  getBlock: TResolveDragSelectBlockOptions["getBlock"]) => {
    let directBlock = block;
    while (directBlock.parentElement && directBlock.parentElement !== containerBlock) {
        const parentBlock = getBlock(directBlock.parentElement);
        if (!parentBlock || parentBlock === containerBlock) {
            break;
        }
        directBlock = parentBlock;
    }
    return directBlock;
};

export const resolveBlockDragSelectStart = (options: TResolveDragSelectBlockOptions) => {
    const firstPointElement = options.elementFromPoint(options.x, options.top);
    if (!firstPointElement) {
        return options.fallbackBlock || false;
    }
    const firstBlock = options.getBlock(firstPointElement);
    if (!options.isContainerSurface(firstPointElement)) {
        return firstBlock || options.fallbackBlock || false;
    }

    let probeY = options.top;
    while (probeY < options.bottom) {
        probeY = Math.min(probeY + 4, options.bottom);
        const probeElement = options.elementFromPoint(options.x, probeY);
        const probeBlock = probeElement && options.getBlock(probeElement);
        if (!probeBlock) {
            continue;
        }
        if (!firstBlock) {
            return probeBlock;
        }
        if (probeBlock === firstBlock) {
            continue;
        }
        if (firstBlock.contains(probeBlock)) {
            return getDirectDescendantBlock(firstBlock, probeBlock, options.getBlock);
        }
        break;
    }
    return firstBlock;
};
