import {hasClosestByClassName, isInEmbedBlock} from "../util/hasClosest";
import {focusBlock} from "../util/selection";
import {scrollCenter} from "../../util/highlightById";
import {getContenteditableElement} from "./getBlock";
import {getCalloutTitleNavigationTarget} from "./calloutCaret";
import {focusEditableAtGoalX, getCaretGoalX, TVerticalDirection} from "./verticalCaret";
import {focusAVTitleByVerticalArrow, focusAVVerticalRegion} from "../render/av/focus";
import {getAdjacentVisibleBlock, getVisibleBoundaryBlock} from "./verticalTarget";

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
    if (!focusBlock(element, undefined, direction === "down")) {
        return false;
    }
    clearAtomicFocus(editorElement);
    element.classList.add(VERTICAL_NAVIGATION_ATOMIC_CLASS);
    return true;
};

const focusResolvedRegion = (protyle: IProtyle, element: Element | undefined,
                             direction: TVerticalDirection, goalX: number) => {
    if (!element) {
        return false;
    }
    const targetElement = element as HTMLElement;
    let focused = false;
    if (targetElement.classList.contains("av")) {
        focused = focusAVVerticalRegion(targetElement, direction, goalX);
        if (focused) {
            clearAtomicFocus(protyle.wysiwyg.element);
        } else {
            focused = focusAtomicRegion(protyle.wysiwyg.element, targetElement, direction);
        }
    } else {
        const editableElement = getContenteditableElement(targetElement);
        if (editableElement) {
            focused = focusEditableAtGoalX(editableElement, direction, goalX);
            if (focused) {
                clearAtomicFocus(protyle.wysiwyg.element);
            }
        } else {
            focused = focusAtomicRegion(protyle.wysiwyg.element, targetElement, direction);
        }
    }
    if (!focused) {
        return false;
    }
    scrollCenter(protyle, targetElement);
    return true;
};

const focusDocumentTitle = (protyle: IProtyle, direction: TVerticalDirection, goalX: number) => {
    if (direction !== "up" || !protyle.title?.editElement ||
        protyle.title.editElement.getClientRects().length === 0) {
        return false;
    }
    const focused = focusEditableAtGoalX(protyle.title.editElement, direction, goalX);
    if (focused) {
        clearAtomicFocus(protyle.wysiwyg.element);
    }
    return focused;
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
                const nestedCalloutTarget = getCalloutTitleNavigationTarget(sourceElement, contentElement, "ArrowDown");
                if (nestedCalloutTarget) {
                    const focused = focusEditableAtGoalX(nestedCalloutTarget, direction, goalX);
                    if (focused) {
                        clearAtomicFocus(protyle.wysiwyg.element);
                        scrollCenter(protyle, hasClosestByClassName(nestedCalloutTarget, "callout") || calloutElement);
                        return true;
                    }
                }
                const targetElement = getVisibleBoundaryBlock(contentElement, direction);
                if (targetElement && focusResolvedRegion(protyle, targetElement, direction, goalX)) {
                    return true;
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

    let adjacentElement = getAdjacentVisibleBlock(sourceElement, direction);
    while (adjacentElement) {
        const calloutTarget = getCalloutTitleNavigationTarget(sourceElement, adjacentElement,
            direction === "up" ? "ArrowUp" : "ArrowDown");
        if (calloutTarget) {
            const focused = focusEditableAtGoalX(calloutTarget, direction, goalX);
            if (focused) {
                clearAtomicFocus(protyle.wysiwyg.element);
                scrollCenter(protyle, hasClosestByClassName(calloutTarget, "callout") || sourceElement);
                return true;
            }
        }
        const targetElement = getVisibleBoundaryBlock(adjacentElement, direction);
        if (targetElement && focusResolvedRegion(protyle, targetElement, direction, goalX)) {
            return true;
        }
        adjacentElement = getAdjacentVisibleBlock(adjacentElement, direction);
    }
    if (isInEmbedBlock(sourceElement)) {
        return false;
    }
    return focusDocumentTitle(protyle, direction, goalX);
};

export const leaveAVVerticalRegion = (protyle: IProtyle, sourceElement: HTMLElement,
                                      direction: TVerticalDirection, goalX: number) => {
    if (direction === "up" && focusAVTitleByVerticalArrow(sourceElement, direction, goalX)) {
        return true;
    }
    return focusAdjacentVerticalRegion(protyle, sourceElement, direction, goalX);
};
