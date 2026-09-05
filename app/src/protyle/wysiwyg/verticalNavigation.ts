import {hasClosestByClassName} from "../util/hasClosest";
import {focusBlock} from "../util/selection";
import {scrollCenter} from "../../util/highlightById";
import {
    getContenteditableElement,
    getFirstBlock,
    getLastBlock,
    getNextBlock,
    getPreviousBlock,
    isContainerBlock,
    isNotEditBlock,
} from "./getBlock";
import {getCalloutTitleNavigationTarget} from "./calloutCaret";
import {focusEditableAtGoalX, getCaretGoalX, TVerticalDirection} from "./verticalCaret";
import {focusAVTitleByVerticalArrow, focusAVVerticalRegion} from "../render/av/focus";

export const VERTICAL_NAVIGATION_ATOMIC_CLASS = "protyle-wysiwyg--navigation";

const navigationGoalX = new WeakMap<HTMLElement, number>();
const resetBoundEditors = new WeakSet<HTMLElement>();

const clearAtomicFocus = (editorElement: HTMLElement) => {
    editorElement.querySelectorAll(`.${VERTICAL_NAVIGATION_ATOMIC_CLASS}`).forEach(item => {
        item.classList.remove(VERTICAL_NAVIGATION_ATOMIC_CLASS);
    });
};

export const resetVerticalNavigation = (editorElement: HTMLElement) => {
    navigationGoalX.delete(editorElement);
    clearAtomicFocus(editorElement);
};

export const bindVerticalNavigationReset = (editorElement: HTMLElement) => {
    if (resetBoundEditors.has(editorElement)) {
        return;
    }
    resetBoundEditors.add(editorElement);
    ["pointerdown", "input", "focusout"].forEach(type => {
        editorElement.addEventListener(type, () => resetVerticalNavigation(editorElement), true);
    });
};

export const prepareVerticalNavigation = (editorElement: HTMLElement, event: KeyboardEvent, range: Range,
                                          fallbackElement?: Element, preferredGoalX?: number) => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key) || event.altKey || event.shiftKey ||
        event.metaKey || event.ctrlKey || event.isComposing) {
        resetVerticalNavigation(editorElement);
        return;
    }
    let goalX = navigationGoalX.get(editorElement);
    if (goalX === undefined) {
        goalX = preferredGoalX ?? getCaretGoalX(range, fallbackElement);
        navigationGoalX.set(editorElement, goalX);
    }
    return goalX;
};

export const isAtomicVerticalNavigationTarget = (element: Element) =>
    element.classList.contains(VERTICAL_NAVIGATION_ATOMIC_CLASS);

const focusAtomicRegion = (editorElement: HTMLElement, element: HTMLElement, direction: TVerticalDirection) => {
    clearAtomicFocus(editorElement);
    element.classList.add(VERTICAL_NAVIGATION_ATOMIC_CLASS);
    focusBlock(element, undefined, direction === "down");
};

const getAdjacentBlock = (element: Element, direction: TVerticalDirection) =>
    direction === "up" ? getPreviousBlock(element) : getNextBlock(element);

const getBoundaryBlock = (element: Element, direction: TVerticalDirection) => {
    if (element.getAttribute("fold") === "1" || element.classList.contains("av") ||
        (!isContainerBlock(element) && isNotEditBlock(element))) {
        return element;
    }
    const boundaryElement = direction === "up" ? getLastBlock(element) : getFirstBlock(element);
    let parentElement = boundaryElement.parentElement?.closest("[data-node-id]");
    while (parentElement && element.contains(parentElement)) {
        if (!isContainerBlock(parentElement) && isNotEditBlock(parentElement)) {
            return parentElement;
        }
        parentElement = parentElement.parentElement?.closest("[data-node-id]");
    }
    return boundaryElement;
};

const focusResolvedRegion = (protyle: IProtyle, element: Element, direction: TVerticalDirection, goalX: number) => {
    const targetElement = element as HTMLElement;
    clearAtomicFocus(protyle.wysiwyg.element);
    if (targetElement.classList.contains("av")) {
        if (!focusAVVerticalRegion(targetElement, direction, goalX)) {
            focusAtomicRegion(protyle.wysiwyg.element, targetElement, direction);
        }
    } else {
        const editableElement = getContenteditableElement(targetElement);
        if (editableElement) {
            focusEditableAtGoalX(editableElement, direction, goalX);
        } else {
            focusAtomicRegion(protyle.wysiwyg.element, targetElement, direction);
        }
    }
    scrollCenter(protyle, targetElement);
    return true;
};

const focusDocumentTitle = (protyle: IProtyle, direction: TVerticalDirection, goalX: number) => {
    if (direction !== "up" || !protyle.title?.editElement ||
        protyle.title.editElement.getClientRects().length === 0) {
        return false;
    }
    clearAtomicFocus(protyle.wysiwyg.element);
    return focusEditableAtGoalX(protyle.title.editElement, direction, goalX);
};

export const focusAdjacentVerticalRegion = (protyle: IProtyle, sourceElement: HTMLElement,
                                             direction: TVerticalDirection, goalX: number,
                                             sourceNode?: Node) => {
    const calloutTitleElement = sourceNode && hasClosestByClassName(sourceNode, "callout-title");
    if (calloutTitleElement) {
        const calloutElement = hasClosestByClassName(calloutTitleElement, "callout");
        if (calloutElement && direction === "down") {
            const contentElement = calloutElement.querySelector(":scope > .callout-content");
            if (contentElement) {
                const firstElement = getFirstBlock(contentElement);
                if (firstElement !== contentElement) {
                    return focusResolvedRegion(protyle, firstElement, direction, goalX);
                }
            }
        }
        if (calloutElement) {
            sourceElement = calloutElement;
        }
    }

    if (sourceElement.classList.contains("av") && sourceNode &&
        hasClosestByClassName(sourceNode, "av__title")) {
        if (direction === "down" && focusAVVerticalRegion(sourceElement, direction, goalX, false)) {
            return true;
        }
    }

    const adjacentElement = getAdjacentBlock(sourceElement, direction);
    const calloutTarget = getCalloutTitleNavigationTarget(sourceElement, adjacentElement,
        direction === "up" ? "ArrowUp" : "ArrowDown");
    if (calloutTarget) {
        clearAtomicFocus(protyle.wysiwyg.element);
        focusEditableAtGoalX(calloutTarget, direction, goalX);
        scrollCenter(protyle, hasClosestByClassName(calloutTarget, "callout") || sourceElement);
        return true;
    }
    if (!adjacentElement) {
        focusDocumentTitle(protyle, direction, goalX);
        return true;
    }
    return focusResolvedRegion(protyle, getBoundaryBlock(adjacentElement, direction), direction, goalX);
};

export const leaveAVVerticalRegion = (protyle: IProtyle, sourceElement: HTMLElement,
                                      direction: TVerticalDirection, goalX: number) => {
    if (direction === "up" && focusAVTitleByVerticalArrow(sourceElement, direction, goalX)) {
        return true;
    }
    return focusAdjacentVerticalRegion(protyle, sourceElement, direction, goalX);
};
