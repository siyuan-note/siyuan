import {isInEmbedBlock} from "../util/hasClosest";
import {focusBlock, focusByRange} from "../util/selection";
import {scrollCenter} from "../../util/highlightById";
import {getContenteditableElement} from "./getBlock";
import {focusEditableAtGoalX, getCaretGoalX, TVerticalDirection} from "./verticalCaret";
import {focusAVTitleByVerticalArrow, focusAVVerticalRegion} from "../render/av/focus";
import {
    getAdjacentVisibleBlock,
    getVerticalNavigationScope,
    getVisibleBoundaryBlock,
    isVerticalNavigationElementVisible,
} from "./verticalTarget";
import {
    getHostVerticalRegion,
    getHostVerticalTitleRegion,
    getTableBoundaryCell,
    IHostVerticalRegion,
} from "./verticalRegion";
import {getFoldedNavigationOwner} from "./verticalVisibility";
import {
    shouldKeepAtomicVerticalNavigationTarget,
    VERTICAL_NAVIGATION_ATOMIC_CLASS,
} from "./verticalNavigationState";

const navigationGoalX = new WeakMap<HTMLElement, number>();
const resetBoundEditors = new WeakSet<HTMLElement>();

const clearAtomicFocus = (editorElement: HTMLElement) => {
    editorElement.querySelectorAll(`.${VERTICAL_NAVIGATION_ATOMIC_CLASS}`).forEach(item => {
        item.classList.remove(VERTICAL_NAVIGATION_ATOMIC_CLASS);
    });
};

const resetVerticalNavigationGoal = (editorElement: HTMLElement) => {
    navigationGoalX.delete(editorElement);
};

const clearVerticalNavigation = (editorElement: HTMLElement) => {
    resetVerticalNavigationGoal(editorElement);
    clearAtomicFocus(editorElement);
};

const clearStaleAtomicFocus = (editorElement: HTMLElement) => {
    const selection = editorElement.ownerDocument.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
    editorElement.querySelectorAll(`.${VERTICAL_NAVIGATION_ATOMIC_CLASS}`).forEach(item => {
        if (!range || !shouldKeepAtomicVerticalNavigationTarget(item, range)) {
            item.classList.remove(VERTICAL_NAVIGATION_ATOMIC_CLASS);
        }
    });
};

export const bindVerticalNavigationReset = (editorElement: HTMLElement) => {
    if (resetBoundEditors.has(editorElement)) {
        return;
    }
    resetBoundEditors.add(editorElement);
    ["pointerdown", "input"].forEach(type => {
        editorElement.addEventListener(type, () => clearVerticalNavigation(editorElement), true);
    });
    editorElement.addEventListener("keyup", () => clearStaleAtomicFocus(editorElement), true);
    editorElement.addEventListener("focusout", event => {
        clearAtomicFocus(editorElement);
        // 宿主标题与正文间的焦点切换仍属于同一次纵向导航，真正离开当前编辑器后再清除目标列。
        const relatedElement = event.relatedTarget as Element | null;
        if (relatedElement?.closest?.(".protyle-wysiwyg") === editorElement) {
            return;
        }
        queueMicrotask(() => {
            const activeElement = editorElement.ownerDocument.activeElement;
            if (!activeElement?.closest || activeElement.closest(".protyle-wysiwyg") !== editorElement) {
                navigationGoalX.delete(editorElement);
            }
        });
    }, true);
};

export const prepareVerticalNavigation = (editorElement: HTMLElement, event: KeyboardEvent, range: Range,
                                          fallbackElement?: Element, preferredGoalX?: number) => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key) || event.altKey || event.shiftKey ||
        event.metaKey || event.ctrlKey || event.isComposing) {
        resetVerticalNavigationGoal(editorElement);
        return;
    }
    let goalX = navigationGoalX.get(editorElement);
    if (goalX === undefined) {
        goalX = preferredGoalX ?? getCaretGoalX(range, fallbackElement);
        navigationGoalX.set(editorElement, goalX);
    }
    return goalX;
};

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

type TVerticalNavigationOutcome = "moved" | "blocked" | "none";

type TVerticalNavigationTarget = {
    type: "atomic";
    owner: HTMLElement;
    scope?: Element;
} | {
    type: "database";
    owner: HTMLElement;
    scope?: Element;
} | {
    type: "text";
    owner: HTMLElement;
    editable: Element;
    scope?: Element;
    reveal?: () => boolean;
    rollbackReveal?: () => void;
};

const resolveBlockVerticalNavigationTarget = (editorElement: HTMLElement, element: HTMLElement,
                                              direction: TVerticalDirection, goalX: number): TVerticalNavigationTarget => {
    const scope = getVerticalNavigationScope(element, editorElement);
    if (element.getAttribute("fold") === "1") {
        return {type: "atomic", owner: element, scope};
    }
    const region = getHostVerticalRegion(element);
    if (region?.database) {
        return {type: "database", owner: element, scope};
    }
    let editable = direction === "down" && region?.title ? region.title : getContenteditableElement(element);
    if (editable?.tagName === "TABLE") {
        editable = getTableBoundaryCell(editable as HTMLTableElement, direction, goalX);
    }
    return editable ? {type: "text", owner: element, editable, scope} :
        {type: "atomic", owner: element, scope};
};

const isVerticalNavigationTargetCurrent = (protyle: IProtyle, target: TVerticalNavigationTarget) =>
    target.owner.isConnected && (!target.scope || target.scope.isConnected &&
        (target.scope === protyle.wysiwyg.element || protyle.wysiwyg.element.contains(target.scope)) &&
        target.scope.contains(target.owner)) &&
    (target.type !== "text" || target.editable.isConnected &&
        (target.owner === target.editable || target.owner.contains(target.editable)));

// 显现、滚动和 Selection 修改集中在提交阶段，解析阶段不改变编辑器状态。
const commitVerticalNavigationTarget = (protyle: IProtyle, target: TVerticalNavigationTarget,
                                        direction: TVerticalDirection, goalX: number) => {
    if (!isVerticalNavigationTargetCurrent(protyle, target)) {
        return false;
    }
    let focused = false;
    if (target.type === "atomic") {
        focused = focusAtomicRegion(protyle.wysiwyg.element, target.owner, direction);
    } else if (target.type === "database") {
        focused = focusAVVerticalRegion(target.owner, direction, goalX, true, protyle.contentElement);
        if (focused) {
            clearAtomicFocus(protyle.wysiwyg.element);
        } else {
            focused = focusAtomicRegion(protyle.wysiwyg.element, target.owner, direction);
        }
    } else {
        const revealed = !!target.reveal;
        if (revealed && !target.reveal()) {
            return false;
        }
        if (!isVerticalNavigationTargetCurrent(protyle, target) ||
            !focusEditableAtGoalX(target.editable, direction, goalX, protyle.contentElement)) {
            if (revealed) {
                target.rollbackReveal?.();
            }
            return false;
        }
        clearAtomicFocus(protyle.wysiwyg.element);
        focused = true;
    }
    if (focused && target.scope) {
        scrollCenter(protyle, target.owner);
    }
    return focused;
};

const focusResolvedRegion = (protyle: IProtyle, element: Element | undefined,
                             direction: TVerticalDirection, goalX: number): TVerticalNavigationOutcome => {
    if (!element) {
        return "none";
    }
    const target = resolveBlockVerticalNavigationTarget(protyle.wysiwyg.element, element as HTMLElement,
        direction, goalX);
    return commitVerticalNavigationTarget(protyle, target, direction, goalX) ? "moved" : "blocked";
};

export const focusFirstVerticalRegion = (protyle: IProtyle, goalX: number): TVerticalNavigationOutcome => {
    if (protyle.disabled || !protyle.wysiwyg.element.isConnected) {
        return "blocked";
    }
    return focusResolvedRegion(protyle, getVisibleBoundaryBlock(protyle.wysiwyg.element, "down"), "down", goalX);
};

const focusDocumentTitle = (protyle: IProtyle, direction: TVerticalDirection,
                            goalX: number): TVerticalNavigationOutcome => {
    if (direction !== "up" || !protyle.title?.editElement ||
        protyle.title.editElement.getClientRects().length === 0) {
        return "none";
    }
    const target: TVerticalNavigationTarget = {
        type: "text",
        owner: protyle.title.editElement,
        editable: protyle.title.editElement,
    };
    return commitVerticalNavigationTarget(protyle, target, direction, goalX) ? "moved" : "blocked";
};

const focusHostTitle = (protyle: IProtyle, region: IHostVerticalRegion,
                        direction: TVerticalDirection, goalX: number): TVerticalNavigationOutcome => {
    if (!region.title) {
        return "none";
    }
    const revealTitle = !isVerticalNavigationElementVisible(region.title);
    const target: TVerticalNavigationTarget = {
        type: "text",
        owner: region.owner,
        editable: region.title,
        scope: getVerticalNavigationScope(region.owner, protyle.wysiwyg.element),
        reveal: revealTitle ? () => !!region.setTitleEditing?.(true) : undefined,
        rollbackReveal: revealTitle ? () => region.setTitleEditing?.(false) : undefined,
    };
    return commitVerticalNavigationTarget(protyle, target, direction, goalX) ? "moved" : "blocked";
};

export const focusAdjacentVerticalRegion = (protyle: IProtyle, sourceElement: HTMLElement,
                                             direction: TVerticalDirection, goalX: number,
                                             sourceNode?: Node): TVerticalNavigationOutcome => {
    const foldedOwner = getFoldedNavigationOwner(sourceElement);
    if (foldedOwner) {
        sourceElement = foldedOwner as HTMLElement;
    }
    const titleRegion = !foldedOwner && sourceNode && getHostVerticalTitleRegion(sourceNode);
    if (titleRegion) {
        sourceElement = titleRegion.owner;
        if (direction === "down") {
            if (titleRegion.database) {
                if (focusAVVerticalRegion(sourceElement, direction, goalX, false, protyle.contentElement)) {
                    return "moved";
                }
            } else if (titleRegion.content) {
                const targetElement = getVisibleBoundaryBlock(titleRegion.content, direction);
                if (targetElement) {
                    return focusResolvedRegion(protyle, targetElement, direction, goalX);
                }
            }
        }
    }

    // 先跨越宿主正文与标题的区域边界，再查找所有者之外的相邻块。
    if (direction === "up") {
        let ancestor = sourceElement.parentElement;
        while (ancestor && ancestor !== protyle.wysiwyg.element) {
            const region = getHostVerticalRegion(ancestor);
            if (region?.content?.contains(sourceElement) && region.title &&
                getVisibleBoundaryBlock(region.content, "down") === sourceElement) {
                return focusHostTitle(protyle, region, direction, goalX);
            }
            ancestor = ancestor.parentElement;
        }
    }

    let adjacentElement = getAdjacentVisibleBlock(sourceElement, direction);
    while (adjacentElement) {
        const targetElement = getVisibleBoundaryBlock(adjacentElement, direction);
        if (targetElement) {
            return focusResolvedRegion(protyle, targetElement, direction, goalX);
        }
        adjacentElement = getAdjacentVisibleBlock(adjacentElement, direction);
    }
    if (isInEmbedBlock(sourceElement)) {
        return "blocked";
    }
    return focusDocumentTitle(protyle, direction, goalX);
};

export const leaveAVVerticalRegion = (protyle: IProtyle, sourceElement: HTMLElement,
                                      direction: TVerticalDirection, goalX: number) => {
    if (direction === "up" && focusAVTitleByVerticalArrow(sourceElement, direction, goalX,
        protyle.contentElement)) {
        return true;
    }
    return focusAdjacentVerticalRegion(protyle, sourceElement, direction, goalX) === "moved";
};
