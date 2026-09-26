import {getSidebarDock, getSidebarElement, popSidebar, switchToNextSidebarTab} from "./sidebar";
import {getMobileSidebarConfig} from "./mobileBarsConfig";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasTopClosestByClassName,
    isInEmbedBlock,
} from "../../protyle/util/hasClosest";
import {closeModel, closePanel, showPanelMask} from "./closePanel";
import {activeBlur, resetAndroidBoundedSelectionGesture} from "./keyboardToolbar";
import {isChromeBrowser, isInAndroid, isInHarmony, isIPhone} from "../../protyle/util/compatibility";
import {getRangeByPoint} from "../../protyle/util/selection";
import {getCurrentEditor} from "../editor";
import {Constants} from "../../constants";
import {getEmbedGutterOperationContext} from "../../protyle/wysiwyg/getBlock";
import {backModel} from "../menu/model";
import {
    hasVisibleSelectionText,
    shouldRestoreLongPressSelection,
} from "./touchSelection";
import {stripSemanticMarkersFromRangeText} from "../../protyle/util/inlineElementMarker";
import {getTouchAxis, shouldStartLongPressMultiSelect} from "./touchGesture";
import {getMobileBlockSelectionElement} from "./blockSelection";
import {updateMultiSelectToolbar} from "./multiSelectToolbar";
import {
    getOpeningSidebar,
    getSidebarClosingOffset,
    getSidebarOpeningOffset,
    MOBILE_SIDEBAR_SWIPE_ACTIVATION_DISTANCE,
    type MobileSidebarSide,
    type MobileSwipeDirection,
    setSidebarSwipeState,
    shouldCloseGlobalMenu,
    shouldCommitSidebarSwipe,
    shouldDragOpenSidebar,
} from "./touchPanelGesture";

let clientX: number;
let clientY: number;
let xDiff: number;
let yDiff: number;
let time: number;
let firstDirection: MobileSwipeDirection;
let firstXY: "x" | "y";
let lastClientX: number;    // 和起始方向不一致时，记录最后一次的 clientX
let scrollBlock: boolean;
let isFirstMove = true;
let swipeStartSidebar: MobileSidebarSide;
let preventSwipe = false;
// 长按进入多选的定时器
let longPressTimer: number;
let longPressBlockElement: HTMLElement;
let longPressTouchRange: Range;

const sideMaskElement = document.querySelector(".side-mask") as HTMLElement;

const updateSidebarSwipeState = (activeSide?: MobileSidebarSide) => {
    setSidebarSwipeState({
        left: getSidebarElement("left"),
        right: getSidebarElement("right"),
    }, sideMaskElement, activeSide);
};

const getTargetSidebar = (target: HTMLElement): MobileSidebarSide | undefined => {
    if (hasClosestByAttribute(target, "id", "sidebar", true)) {
        return "left";
    }
    if (hasClosestByAttribute(target, "id", "sidebarRight", true)) {
        return "right";
    }
};

// 清除长按进入多选的定时器
const clearLongPress = () => {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = undefined;
    }
};

const clearInvisibleEditorSelection = () => {
    const editor = getCurrentEditor();
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
        return false;
    }
    const range = selection.getRangeAt(0);
    if (range.collapsed || hasVisibleSelectionText(stripSemanticMarkersFromRangeText(range)) ||
        !editor.protyle.wysiwyg.element.contains(range.startContainer) ||
        !editor.protyle.wysiwyg.element.contains(range.endContainer)) {
        return false;
    }
    selection.removeAllRanges();
    activeBlur();
    return true;
};

const restoreInvisibleLongPressSelection = () => {
    const editor = getCurrentEditor();
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0 || !longPressBlockElement ||
        !longPressTouchRange?.startContainer.isConnected ||
        !longPressBlockElement.contains(longPressTouchRange.startContainer)) {
        return false;
    }
    const range = selection.getRangeAt(0);
    if (!editor.protyle.wysiwyg.element.contains(range.startContainer) ||
        !editor.protyle.wysiwyg.element.contains(range.endContainer)) {
        return false;
    }
    const startBlockElement = hasClosestBlock(range.startContainer);
    const endBlockElement = hasClosestBlock(range.endContainer);
    if (!shouldRestoreLongPressSelection(
        range.collapsed,
        stripSemanticMarkersFromRangeText(range),
        startBlockElement ? startBlockElement.getAttribute("data-node-id") : undefined,
        endBlockElement ? endBlockElement.getAttribute("data-node-id") : undefined,
        longPressBlockElement.getAttribute("data-node-id"),
    )) {
        return false;
    }
    const restoredRange = longPressTouchRange.cloneRange();
    selection.removeAllRanges();
    selection.addRange(restoredRange);
    window.siyuan.mobile.touchRange = restoredRange.cloneRange();
    return true;
};

export const handleTouchUp = () => {
    updateSidebarSwipeState();
    resetAndroidBoundedSelectionGesture();
    if (Date.now() - time < Constants.TIMEOUT_MULTIPLE_SELECT) {
        clearLongPress();
    }
    if (!restoreInvisibleLongPressSelection()) {
        clearInvisibleEditorSelection();
    }
    longPressBlockElement = undefined;
    longPressTouchRange = undefined;
};

export const handleTouchSelectionChange = () => {
    if (longPressBlockElement && !restoreInvisibleLongPressSelection()) {
        clearInvisibleEditorSelection();
    }
};

export const handleTouchEnd = (event: TouchEvent) => {
    updateSidebarSwipeState();
    if (preventSwipe) {
        return;
    }
    const target = event.target as HTMLElement;
    const currentTime = Date.now();
    const editor = getCurrentEditor();
    if (!isInHarmony() && !isInAndroid()) {
        handleTouchUp();
    }
    if (Math.abs(clientX - event.changedTouches[0].clientX) < Constants.SIZE_DRAG_THRESHOLD &&
        Math.abs(clientY - event.changedTouches[0].clientY) < Constants.SIZE_DRAG_THRESHOLD) {
        if (editor && editor.protyle.toolbar.isMultiSelectMode()) {
            if (longPressTimer) {
                event.stopImmediatePropagation();
                event.preventDefault();
                return;
            }
            // 多选模式
            window.getSelection()?.removeAllRanges();
            activeBlur();
            const touchedBlockElement = hasClosestBlock(target);
            if (touchedBlockElement) {
                const blockElement = getMobileBlockSelectionElement(touchedBlockElement as HTMLElement);
                // 本次按压已在按住期间触发多选，松手时不切换选中态，仅消费该手势
                blockElement.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
                    item.classList.remove("protyle-wysiwyg--select");
                });
                const blockParentElement = hasClosestByClassName(blockElement.parentElement, "protyle-wysiwyg--select");
                if (blockParentElement) {
                    blockParentElement.classList.remove("protyle-wysiwyg--select");
                }
                blockElement.classList.toggle("protyle-wysiwyg--select");
                updateMultiSelectToolbar(editor.protyle.toolbar.subElement,
                    editor.protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").length);
                event.stopImmediatePropagation();
                event.preventDefault();
            }
        } else if (currentTime - time > Constants.TIMEOUT_LONGPRESS) {
            // 长按：多选已在按住满阈值时触发，此处取消定时器避免重复触发
            if (isIPhone() && !isChromeBrowser() && !window.siyuan.touchDragActive) {
                target.dispatchEvent(new MouseEvent("contextmenu", {
                    bubbles: true,
                    cancelable: true,
                    clientX: event.changedTouches[0].clientX,
                    clientY: event.changedTouches[0].clientY,
                }));
            }
            event.stopImmediatePropagation();
            event.preventDefault();
            return;
        }
    }
    if (typeof yDiff === "undefined" && editor?.protyle.options.render.gutter) {
        const nodeElement = hasClosestBlock(target);
        if (nodeElement && nodeElement.closest(".protyle-wysiwyg")) {
            if (nodeElement.classList.contains("list") || nodeElement.classList.contains("li")) {
                // 光标在列表下部应显示右侧的元素，而不是列表本身。放在 windowEvent 中的 mousemove 下处理
                return;
            }
            const embedElement = isInEmbedBlock(nodeElement);
            if (embedElement) {
                editor.protyle.gutter.render(editor.protyle,
                    getEmbedGutterOperationContext(nodeElement) ? nodeElement : embedElement, target);
                return;
            }
            editor.protyle.gutter.render(editor.protyle, nodeElement, target);
        }
    }
    isFirstMove = true;
    if (!clientY || typeof yDiff === "undefined" ||
        target.tagName === "AUDIO" ||
        hasClosestByClassName(target, "b3-dialog", true) ||
        (window.siyuan.mobile.editor && !window.siyuan.mobile.editor.protyle.toolbar.subElement.classList.contains("fn__none")) ||
        hasClosestByClassName(target, "viewer-container") ||
        hasClosestByClassName(target, "keyboard") ||
        hasClosestByAttribute(target, "id", "commonMenu")
    ) {
        return;
    }
    if (window.siyuan.mobile.editor) {
        window.siyuan.mobile.editor.protyle.contentElement.style.overflow = "";
    }

    const finalXDiff = Math.floor(clientX - event.changedTouches[0].clientX);
    const finalYDiff = Math.floor(clientY - event.changedTouches[0].clientY);

    // 有些事件不经过 touchstart 和 touchmove，因此需设置为 null 不再继续执行
    clientX = null;
    // 有些事件不经过 touchmove

    if (!firstXY) {
        return;
    }
    const isXScroll = Math.abs(xDiff) > Math.abs(yDiff);
    const reversing = typeof lastClientX !== "undefined";
    const modelElement = hasClosestByAttribute(target, "id", "model", true);
    if (modelElement) {
        // 面板内横向滚动内容（如数据快照操作按钮行）时不触发关闭面板
        if (!scrollBlock && isXScroll && firstDirection === "toRight" && !reversing &&
            !hasClosestByClassName(target, "protyle-wysiwyg", true) &&
            // 划选文字时不触发关闭面板
            (getSelection().rangeCount === 0 || getSelection().toString() === "")) {
            if (!backModel()) {
                closeModel();
            }
        }
        return;
    }

    const menuElement = hasClosestByAttribute(target, "id", "menu", true);
    if (menuElement) {
        if (!scrollBlock && isXScroll && shouldCloseGlobalMenu(firstDirection, reversing)) {
            closePanel();
        }
        return;
    }

    const targetSidebar = getTargetSidebar(target);
    if (scrollBlock) {
        if (targetSidebar) {
            popSidebar(targetSidebar, false);
        } else {
            closePanel();
        }
        return;
    }

    const commitSidebarSwipe = firstXY === "x" && Math.abs(finalXDiff) > Math.abs(finalYDiff) && shouldCommitSidebarSwipe(
        firstDirection,
        finalXDiff,
        currentTime - time,
        window.innerWidth,
    );

    if (targetSidebar) {
        if (commitSidebarSwipe && shouldDragOpenSidebar(targetSidebar, firstDirection)) {
            closePanel();
        } else {
            popSidebar(targetSidebar, false);
            if (commitSidebarSwipe) {
                switchToNextSidebarTab(targetSidebar);
            }
        }
        return;
    }
    if (!getMobileSidebarConfig().sidebarSwipe) {
        return;
    }
    if (!commitSidebarSwipe) {
        closePanel();
        return;
    }

    popSidebar(getOpeningSidebar(firstDirection));
};

const resetTouchGesture = () => {
    isFirstMove = true;
    clientX = null;
    clientY = null;
    xDiff = undefined;
    yDiff = undefined;
    firstDirection = undefined;
    firstXY = undefined;
    lastClientX = undefined;
    previousClientX = undefined;
    swipeStartSidebar = undefined;
    scrollBlock = false;
    preventSwipe = false;
    clearLongPress();
};

export const handleTouchCancel = () => {
    updateSidebarSwipeState();
    if (!isFirstMove) {
        if (swipeStartSidebar) {
            popSidebar(swipeStartSidebar, false);
        } else {
            closePanel();
        }
    }
    if (window.siyuan.mobile.editor) {
        window.siyuan.mobile.editor.protyle.contentElement.style.overflow = "";
    }
    resetTouchGesture();
    handleTouchUp();
};

export const handleTouchStart = (event: TouchEvent) => {
    updateSidebarSwipeState();
    resetTouchGesture();
    time = Date.now();
    longPressBlockElement = undefined;
    longPressTouchRange = undefined;
    const target = event.touches[0].target as HTMLElement;
    swipeStartSidebar = getTargetSidebar(target);
    if (0 < event.touches.length && (target.tagName === "VIDEO" || target.tagName === "AUDIO")) {
        // https://github.com/siyuan-note/siyuan/issues/14569
        activeBlur();
        return;
    }
    // 自行处理触摸的内容独占整轮手势，松手和取消时也不操作外层侧栏。
    preventSwipe = !!hasClosestByAttribute(target, "data-prevent-swipe", null, true);
    if (preventSwipe) {
        return;
    }
    // 存在其他拖拽元素时
    const otherTouchElement = hasClosestByClassName(target, "b3-chip");
    if ((otherTouchElement && otherTouchElement.parentElement.classList.contains("b3-chips__doctag")) ||
        target.closest(".protyle-gutters") ||
        target.closest(".protyle-action") ||
        target.closest(".protyle-action__drag") ||
        target.closest(".av__gallery") ||
        (target.tagName === "IMG" && target.style.cursor === "move" && target.parentElement.classList.contains("protyle-background__img"))) {
        clientX = null;
        clientY = null;
        return;
    }
    const editor = getCurrentEditor();
    if (getSelection().rangeCount > 0 && hasClosestBlock(event.target as Element) &&
        editor && !editor.protyle.disabled && event.touches[0].clientY > window.innerHeight / 2 &&
        document.querySelector("#keyboardToolbar").classList.contains("fn__none")) {
        window.siyuan.mobile.touchRange = getRangeByPoint(event.touches[0].clientX, event.touches[0].clientY);
    }

    if (isIPhone() ||
        (event.touches[0].clientX > 8 && event.touches[0].clientX < window.innerWidth - 8)) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    } else {
        clientX = null;
        clientY = null;
        event.stopImmediatePropagation();
    }
    // 长按编辑器内块达到阈值时直接进入多选模式，无需抬手
    if (clientX && clientY && editor && !editor.protyle.toolbar.isMultiSelectMode()) {
        const blockElement = hasClosestBlock(target);
        if (blockElement && editor.protyle.wysiwyg.element.contains(blockElement) &&
            shouldStartLongPressMultiSelect(
                target.tagName,
                target.dataset.type,
                !!hasClosestByAttribute(target, "data-type", "inline-math"),
                target.tagName === "IMG" && !!hasClosestByClassName(target, "img"),
            )) {
            longPressBlockElement = blockElement;
            const touchRange = getRangeByPoint(event.touches[0].clientX, event.touches[0].clientY);
            const touchRangeElement = touchRange.startContainer.nodeType === Node.ELEMENT_NODE ?
                touchRange.startContainer as Element : touchRange.startContainer.parentElement;
            const editableElement = touchRangeElement?.closest('[contenteditable="true"]');
            if (editableElement && blockElement.contains(editableElement)) {
                longPressTouchRange = touchRange.cloneRange();
                longPressTouchRange.collapse(true);
            }
            longPressTimer = window.setTimeout(() => {
                clearInvisibleEditorSelection();
                const selection = window.getSelection();
                if (selection?.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    if (!range.collapsed && hasVisibleSelectionText(stripSemanticMarkersFromRangeText(range)) &&
                        editor.protyle.wysiwyg.element.contains(range.startContainer) &&
                        editor.protyle.wysiwyg.element.contains(range.endContainer)) {
                        longPressTimer = undefined;
                        return;
                    }
                }
                window.getSelection()?.removeAllRanges();
                const selectionBlockElement = getMobileBlockSelectionElement(blockElement as HTMLElement);
                editor.protyle.toolbar.showMultiSelectMode(editor.protyle, selectionBlockElement);
                if (editor.protyle.options.render.gutter) {
                    editor.protyle.gutter.render(editor.protyle, selectionBlockElement, target);
                }
            }, Constants.TIMEOUT_MULTIPLE_SELECT);
        }
    }
};

let previousClientX: number;
const isHorizontalScrollable = (target: HTMLElement, xDiff: number) => {
    let element: HTMLElement = target;
    while (element && element.id !== "model") {
        if (element.scrollWidth > element.clientWidth + 1 &&
            ["auto", "scroll", "overlay"].includes(getComputedStyle(element).overflowX)) {
            // 按拖动方向仍可继续滚动时视为内容横向滚动，否则继续向上查找外层滚动容器
            if ((xDiff < 0 && element.scrollLeft > 1) ||
                (xDiff > 0 && Math.ceil(element.clientWidth + element.scrollLeft) < element.scrollWidth)) {
                return true;
            }
        }
        element = element.parentElement;
    }
    return false;
};

export const handleTouchMove = (event: TouchEvent) => {
    const target = event.target as HTMLElement;
    // 位移超过阈值说明是滑动而非长按，取消进入多选的定时器
    if (clientX && clientY &&
        (Math.abs(clientX - event.touches[0].clientX) >= 5 || Math.abs(clientY - event.touches[0].clientY) >= 5)) {
        clearLongPress();
        longPressTouchRange = undefined;
    }
    if (!clientX || !clientY ||
        target.tagName === "AUDIO" ||
        document.getElementById("dragGhost") ||
        hasClosestByClassName(target, "b3-dialog", true) ||
        (window.siyuan.mobile.editor && !window.siyuan.mobile.editor.protyle.toolbar.subElement.classList.contains("fn__none")) ||
        hasClosestByClassName(target, "keyboard") ||
        hasClosestByClassName(target, "viewer-container") ||
        hasClosestByAttribute(target, "id", "commonMenu") || firstXY === "y"
    ) {
        return;
    }

    // 正在编辑时禁止滑动
    if (!document.querySelector("#keyboardToolbar").classList.contains("fn__none")) {
        return;
    }
    // 只读状态下选中内容时时禁止滑动
    if (getSelection().rangeCount > 0) {
        // 选中后扩选的情况
        const range = getSelection().getRangeAt(0);
        const currentEditor = getCurrentEditor();
        const targetSidebar = getTargetSidebar(target);
        if (hasVisibleSelectionText(stripSemanticMarkersFromRangeText(range)) &&
            (currentEditor?.protyle.wysiwyg.element.contains(range.startContainer) ||
                (targetSidebar && getSidebarElement(targetSidebar)?.contains(range.startContainer)))) {
            return;
        }
    }

    xDiff = Math.floor(clientX - event.touches[0].clientX);
    yDiff = Math.floor(clientY - event.touches[0].clientY);
    // 上下滚动防止左右滑动
    if (!firstXY) {
        const sidebarGesture = !hasClosestByAttribute(target, "id", "model", true) &&
            !hasClosestByAttribute(target, "id", "menu", true);
        firstXY = getTouchAxis(xDiff, yDiff, sidebarGesture ?
            MOBILE_SIDEBAR_SWIPE_ACTIVATION_DISTANCE : Constants.SIZE_DRAG_THRESHOLD);
        if (!firstXY) {
            return;
        }
        firstDirection = xDiff > 0 ? "toLeft" : "toRight";
        if (firstXY === "x") {
            const menuElement = hasClosestByAttribute(target, "id", "menu", true);
            if (menuElement && !shouldCloseGlobalMenu(firstDirection, false)) {
                firstXY = "y";
                yDiff = undefined;
            }
        }
    }
    if (firstXY === "y") {
        return;
    }
    if (typeof previousClientX !== "undefined") {
        if (firstDirection === "toRight") {
            if (previousClientX > event.touches[0].clientX) {
                lastClientX = event.touches[0].clientX;
            } else {
                lastClientX = undefined;
            }
        } else if (firstDirection === "toLeft") {
            if (previousClientX < event.touches[0].clientX) {
                lastClientX = event.touches[0].clientX;
            } else {
                lastClientX = undefined;
            }
        }
    }
    previousClientX = event.touches[0].clientX;
    if (Math.abs(xDiff) > Math.abs(yDiff)) {
        if (hasClosestByAttribute(target, "id", "model", true)) {
            // 面板内可横向滚动的元素（如数据快照操作按钮行）由原生滚动处理，避免误触发返回手势
            if (isHorizontalScrollable(target, xDiff)) {
                scrollBlock = true;
            }
            return;
        }
        if (hasClosestByAttribute(target, "id", "menu", true)) {
            return;
        }
        if (!getTargetSidebar(target) && !getMobileSidebarConfig().sidebarSwipe) {
            return;
        }
        if (getTargetSidebar(target) || hasClosestByClassName(target, "agent-chat__messages", true) ||
            hasClosestByClassName(target, "protyle-db-attr__tabs", true)) {
            // 内容可沿手势方向横向滚动时，本次手势持续交给内容，抵达边缘后可再次滑动操作侧栏。
            if (scrollBlock || isHorizontalScrollable(target, xDiff)) {
                scrollBlock = true;
                return;
            }
        }
        if (sideMaskElement.classList.contains("fn__none") || getTargetSidebar(target)) {
            let scrollElement = hasClosestByAttribute(target, "data-type", "NodeCodeBlock");
            if (event.touches.length > 1 || (scrollElement && !scrollElement.classList.contains("code-block"))) {
                scrollBlock = true;
                return;
            }
            if (!scrollElement) {
                scrollElement = hasClosestByAttribute(target, "data-type", "NodeAttributeView") ||
                    hasClosestByAttribute(target, "data-type", "NodeMathBlock") ||
                    hasClosestByAttribute(target, "data-type", "NodeTable") ||
                    hasTopClosestByClassName(target, "list") ||
                    hasTopClosestByClassName(target, "protyle-breadcrumb__bar--nowrap");
            }
            if (scrollElement) {
                if (scrollElement.classList.contains("table")) {
                    scrollElement = scrollElement.firstElementChild as HTMLElement;
                } else if (scrollElement.classList.contains("code-block")) {
                    scrollElement = scrollElement.firstElementChild.nextElementSibling as HTMLElement;
                } else if (scrollElement.classList.contains("av")) {
                    scrollElement = hasClosestByClassName(target, "layout-tab-bar") || hasClosestByClassName(target, "av__scroll") ||
                        hasClosestByClassName(target, "av__kanban");
                } else if (scrollElement.dataset.type === "NodeMathBlock") {
                    while (scrollElement && scrollElement.nodeType === 1) {
                        if (scrollElement.scrollWidth > scrollElement.clientWidth) {
                            break;
                        }
                        scrollElement = scrollElement.firstElementChild as HTMLElement;
                    }
                }
                if (scrollElement && (
                    (xDiff < 0 && scrollElement.scrollLeft > 0) ||
                    (xDiff > 0 && Math.ceil(scrollElement.clientWidth + scrollElement.scrollLeft) < scrollElement.scrollWidth)
                )) {
                    scrollBlock = true;
                }
                if (scrollBlock) {
                    return;
                }
            }
        }

        // 切换页签时保持侧栏展开，松手后按距离和速度判断是否切换。
        const sidebar = getTargetSidebar(target);
        if (sidebar && !shouldDragOpenSidebar(sidebar, firstDirection)) {
            return;
        }
        if (isFirstMove) {
            const openingSidebar = getOpeningSidebar(firstDirection);
            if (!getTargetSidebar(target) && !getSidebarDock(getSidebarElement(openingSidebar))) {
                scrollBlock = true;
                return;
            }
            sideMaskElement.style.zIndex = (++window.siyuan.zIndex).toString();
            showPanelMask();
            const activeSidebar = getTargetSidebar(target) || openingSidebar;
            updateSidebarSwipeState(activeSidebar);
            getSidebarElement(activeSidebar).style.zIndex = (++window.siyuan.zIndex).toString();
            isFirstMove = false;
        }
        const windowWidth = window.innerWidth;
        const targetSidebar = getTargetSidebar(target);
        if (targetSidebar) {
            const offset = getSidebarClosingOffset(targetSidebar, xDiff, windowWidth);
            getSidebarElement(targetSidebar).style.transform = `translateX(${offset}px)`;
            return;
        }

        const openingSidebar = getOpeningSidebar(firstDirection);
        const otherSidebar = openingSidebar === "left" ? "right" : "left";
        getSidebarElement(otherSidebar)?.style.removeProperty("transform");
        const offset = getSidebarOpeningOffset(openingSidebar, xDiff, windowWidth);
        getSidebarElement(openingSidebar).style.transform = `translateX(${offset}px)`;
        activeBlur();
        if (window.siyuan.mobile.editor) {
            window.siyuan.mobile.editor.protyle.contentElement.style.overflow = "hidden";
        }
    }
};
