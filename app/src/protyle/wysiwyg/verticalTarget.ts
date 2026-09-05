import {isInEmbedBlock} from "../util/hasClosest";
import {getNextBlock, getPreviousBlock, isContainerBlock, isNotEditBlock} from "./getBlock";
import type {TVerticalDirection} from "./verticalCaret";

export const isVerticalNavigationElementVisible = (element: Element) =>
    Array.from(element.getClientRects()).some(rect => rect.height > 0.5 || rect.width > 0.5);

const getAdjacentBlock = (element: Element, direction: TVerticalDirection) =>
    direction === "up" ? getPreviousBlock(element) : getNextBlock(element);

export const getAdjacentVisibleBlock = (element: Element, direction: TVerticalDirection) => {
    if (!isVerticalNavigationElementVisible(element)) {
        return false;
    }
    const embedElement = isInEmbedBlock(element);
    const visited = new Set<Element>();
    let adjacentElement = getAdjacentBlock(element, direction);
    while (adjacentElement && !visited.has(adjacentElement)) {
        visited.add(adjacentElement);
        if (embedElement && isInEmbedBlock(adjacentElement) !== embedElement) {
            return false;
        }
        if (isVerticalNavigationElementVisible(adjacentElement)) {
            return adjacentElement;
        }
        adjacentElement = getAdjacentBlock(adjacentElement, direction);
    }
    return false;
};

const getAtomicOwner = (element: Element, boundaryElement: Element) => {
    let currentElement: Element | null = element;
    while (currentElement && boundaryElement.contains(currentElement)) {
        if (currentElement.hasAttribute("data-node-id") && !isContainerBlock(currentElement) &&
            isNotEditBlock(currentElement)) {
            return currentElement;
        }
        if (currentElement === boundaryElement) {
            break;
        }
        currentElement = currentElement.parentElement?.closest("[data-node-id]") || null;
    }
};

export const getVisibleBoundaryBlock = (element: Element, direction: TVerticalDirection) => {
    const candidateElements = [element, ...Array.from(element.querySelectorAll("[data-node-id]"))];
    if (direction === "up") {
        candidateElements.reverse();
    }
    const visited = new Set<Element>();
    for (const candidateElement of candidateElements) {
        if (candidateElement !== element && isInEmbedBlock(candidateElement)) {
            continue;
        }
        const targetElement = getAtomicOwner(candidateElement, element) || candidateElement;
        if (visited.has(targetElement)) {
            continue;
        }
        visited.add(targetElement);
        if (!isContainerBlock(targetElement) && isVerticalNavigationElementVisible(targetElement)) {
            return targetElement;
        }
    }
    if (isVerticalNavigationElementVisible(element)) {
        return element;
    }
};
