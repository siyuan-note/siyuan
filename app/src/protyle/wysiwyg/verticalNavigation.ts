import {isInEmbedBlock} from "../util/hasClosest";
import {focusBlock, focusByRange} from "../util/selection";
import {scrollCenter} from "../../util/highlightById";
import {getContenteditableElement} from "./getBlock";
import {focusEditableAtGoalX, getCaretGoalX, TVerticalDirection} from "./verticalCaret";
import {focusAVTitleByVerticalArrow, focusAVVerticalRegion} from "../render/av/focus";
import {getAdjacentVisibleBlock, getVisibleBoundaryBlock, isVerticalNavigationElementVisible} from "./verticalTarget";
import {getHostVerticalRegion, getHostVerticalTitleRegion, IHostVerticalRegion} from "./verticalRegion";
import {getFoldedNavigationOwner} from "./verticalVisibility";

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
    !!element.closest(`.${VERTICAL_NAVIGATION_ATOMIC_CLASS}`);

const focusAtomicRegion = (editorElement: HTMLElement, element: HTMLElement, direction: TVerticalDirection) => {
    if (element.getAttribute("fold") === "1") {
        const range = document.createRange();
        range.setStart(element, 0);
        range.collapse(true);
        focusByRange(range);
    } else if (!focusBlock(element, undefined, direction === "down")) {
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
    const region = getHostVerticalRegion(targetElement);
    if (targetElement.getAttribute("fold") === "1") {
        focused = focusAtomicRegion(protyle.wysiwyg.element, targetElement, direction);
    } else if (region?.database) {
        focused = focusAVVerticalRegion(targetElement, direction, goalX);
        if (focused) {
            clearAtomicFocus(protyle.wysiwyg.element);
        } else {
            focused = focusAtomicRegion(protyle.wysiwyg.element, targetElement, direction);
        }
    } else {
        const editableElement = direction === "down" && region?.title ? region.title :
            getContenteditableElement(targetElement);
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

const focusHostTitle = (protyle: IProtyle, region: IHostVerticalRegion,
                        direction: TVerticalDirection, goalX: number) => {
    if (!region.title) {
        return false;
    }
    const revealTitle = !isVerticalNavigationElementVisible(region.title);
    if (revealTitle && !region.setTitleEditing?.(true)) {
        return false;
    }
    if (!focusEditableAtGoalX(region.title, direction, goalX)) {
        if (revealTitle) {
            region.setTitleEditing?.(false);
        }
        return false;
    }
    clearAtomicFocus(protyle.wysiwyg.element);
    scrollCenter(protyle, region.owner);
    return true;
};

export const focusAdjacentVerticalRegion = (protyle: IProtyle, sourceElement: HTMLElement,
                                             direction: TVerticalDirection, goalX: number,
                                             sourceNode?: Node) => {
    const foldedOwner = getFoldedNavigationOwner(sourceElement);
    if (foldedOwner) {
        sourceElement = foldedOwner as HTMLElement;
    }
    const titleRegion = !foldedOwner && sourceNode && getHostVerticalTitleRegion(sourceNode);
    if (titleRegion) {
        sourceElement = titleRegion.owner;
        if (direction === "down") {
            if (titleRegion.database) {
                if (focusAVVerticalRegion(sourceElement, direction, goalX, false)) {
                    return true;
                }
            } else if (titleRegion.content && focusResolvedRegion(protyle,
                getVisibleBoundaryBlock(titleRegion.content, direction), direction, goalX)) {
                return true;
            }
        }
    }

    // 先跨越宿主正文与标题的区域边界，再查找所有者之外的相邻块。
    if (direction === "up") {
        let ancestor = sourceElement.parentElement;
        while (ancestor && ancestor !== protyle.wysiwyg.element) {
            const region = getHostVerticalRegion(ancestor);
            if (region?.content?.contains(sourceElement) && region.title &&
                getVisibleBoundaryBlock(region.content, "down") === sourceElement &&
                focusHostTitle(protyle, region, direction, goalX)) {
                return true;
            }
            ancestor = ancestor.parentElement;
        }
    }

    let adjacentElement = getAdjacentVisibleBlock(sourceElement, direction);
    while (adjacentElement) {
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
