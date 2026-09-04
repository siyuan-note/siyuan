import {hasClosestByClassName} from "../util/hasClosest";
import {getFirstBlock} from "./getBlock";

const getCalloutTitleElement = (calloutElement: Element) =>
    calloutElement.querySelector<HTMLElement>(":scope > .callout-info > .callout-title");

export const getCalloutTitleNavigationTarget = (nodeElement: Element, adjacentElement: Element | false | undefined,
                                                 key: string) => {
    if (key === "ArrowUp") {
        const contentElement = hasClosestByClassName(nodeElement, "callout-content");
        if (!contentElement) {
            return;
        }
        const calloutElement = contentElement.parentElement;
        if (!calloutElement?.classList.contains("callout") ||
            getFirstBlock(contentElement) !== nodeElement) {
            return;
        }
        return getCalloutTitleElement(calloutElement);
    }

    if (key === "ArrowDown" && adjacentElement) {
        const firstElement = getFirstBlock(adjacentElement);
        const calloutElement = adjacentElement.classList.contains("callout") ? adjacentElement :
            firstElement?.classList.contains("callout") ? firstElement : undefined;
        if (calloutElement) {
            return getCalloutTitleElement(calloutElement);
        }
    }
};
