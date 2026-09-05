import {hasClosestByClassName} from "../util/hasClosest";
import {getFirstBlock, isContainerBlock} from "./getBlock";

const getCalloutTitleElement = (calloutElement: Element) =>
    calloutElement.querySelector<HTMLElement>(":scope > .callout-info > .callout-title");

const getFirstNavigationBlock = (contentElement: Element) => {
    let blockElement = getFirstBlock(contentElement);
    const visited = new Set<Element>();
    while (blockElement !== contentElement && isContainerBlock(blockElement) &&
        !blockElement.classList.contains("callout") && !visited.has(blockElement)) {
        visited.add(blockElement);
        blockElement = getFirstBlock(blockElement);
    }
    return blockElement;
};

export const getCalloutTitleNavigationTarget = (nodeElement: Element, adjacentElement: Element | false | undefined,
                                                 key: string) => {
    if (key === "ArrowUp") {
        const contentElement = hasClosestByClassName(nodeElement, "callout-content");
        if (!contentElement) {
            return;
        }
        const calloutElement = contentElement.parentElement;
        if (!calloutElement?.classList.contains("callout") ||
            getFirstNavigationBlock(contentElement) !== nodeElement) {
            return;
        }
        return getCalloutTitleElement(calloutElement);
    }

    if (key === "ArrowDown" && adjacentElement) {
        const firstElement = getFirstNavigationBlock(adjacentElement);
        const calloutElement = adjacentElement.classList.contains("callout") ? adjacentElement :
            firstElement?.classList.contains("callout") ? firstElement : undefined;
        if (calloutElement) {
            return getCalloutTitleElement(calloutElement);
        }
    }
};
