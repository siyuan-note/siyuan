import {isInEmbedBlock} from "../util/hasClosest";
import {getNextBlock, getPreviousBlock, isContainerBlock} from "./getBlock";
import type {TVerticalDirection} from "./verticalCaret";
import {getFoldedNavigationOwner, getReachableVerticalRects} from "./verticalVisibility";
import {getHostVerticalRegion} from "./verticalRegion";

export const isVerticalNavigationElementVisible = (element: Element) =>
    getReachableVerticalRects(element, Array.from(element.getClientRects())).length > 0;

const getAdjacentBlock = (element: Element, direction: TVerticalDirection) =>
    direction === "up" ? getPreviousBlock(element) : getNextBlock(element);

const getEmbedNavigationScope = (element: Element) =>
    element.getAttribute("data-type") === "NodeBlockQueryEmbed" ?
        (element.parentElement ? isInEmbedBlock(element.parentElement, false) : false) :
        isInEmbedBlock(element, false);

export const getVerticalNavigationScope = (element: Element, editorElement: HTMLElement) =>
    getEmbedNavigationScope(element) || editorElement;

export const getAdjacentVisibleBlock = (element: Element, direction: TVerticalDirection) => {
    if (!isVerticalNavigationElementVisible(element)) {
        return false;
    }
    const embedScope = getEmbedNavigationScope(element);
    const visited = new Set<Element>();
    let adjacentElement = getAdjacentBlock(getFoldedNavigationOwner(element) || element, direction);
    while (adjacentElement && !visited.has(adjacentElement)) {
        visited.add(adjacentElement);
        if (getEmbedNavigationScope(adjacentElement) !== embedScope) {
            return false;
        }
        if (isVerticalNavigationElementVisible(adjacentElement)) {
            return adjacentElement;
        }
        adjacentElement = getAdjacentBlock(adjacentElement, direction);
    }
    return false;
};

const findVisibleBoundaryBlock = (element: Element, direction: TVerticalDirection,
                                  embedScope: Element | false, boundaryElement: Element): Element | undefined => {
    if (element !== boundaryElement && element.classList.contains("protyle-wysiwyg")) {
        return;
    }
    const isBlock = element.hasAttribute("data-node-id");
    if (isBlock) {
        if (element !== boundaryElement && getEmbedNavigationScope(element) !== embedScope) {
            return;
        }
        if (!isVerticalNavigationElementVisible(element)) {
            return;
        }
        const region = getHostVerticalRegion(element);
        // 非容器块属于一个不透明导航区域，不能根据其内部渲染结果改变外部导航目标。
        if (element.getAttribute("fold") === "1" || !isContainerBlock(element) ||
            (direction === "down" && region?.title && isVerticalNavigationElementVisible(region.title))) {
            return element;
        }
    }

    const children = Array.from(element.children);
    if (direction === "up") {
        children.reverse();
    }
    for (const child of children) {
        const targetElement = findVisibleBoundaryBlock(child, direction, embedScope, boundaryElement);
        if (targetElement) {
            return targetElement;
        }
    }
    return isBlock ? element : undefined;
};

export const getVisibleBoundaryBlock = (element: Element, direction: TVerticalDirection) => {
    const foldedOwner = getFoldedNavigationOwner(element);
    if (foldedOwner) {
        return isVerticalNavigationElementVisible(foldedOwner) ? foldedOwner : undefined;
    }
    return findVisibleBoundaryBlock(element, direction, getEmbedNavigationScope(element), element);
};

export const getAdjacentVerticalBlock = (element: Element, direction: TVerticalDirection) => {
    let adjacent = getAdjacentVisibleBlock(element, direction);
    while (adjacent) {
        const target = getVisibleBoundaryBlock(adjacent, direction);
        if (target) {
            return target as HTMLElement;
        }
        adjacent = getAdjacentVisibleBlock(adjacent, direction);
    }
};
