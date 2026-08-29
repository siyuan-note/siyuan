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
import {getTouchAxis, shouldStartLongPressMultiSelect} from "./touchGesture";
import {getMobileBlockSelectionElement} from "./blockSelection";
import {
    getOpeningSidebar,
    getOpenSidebarReleaseAction,
    getSidebarClosingOffset,
    getSidebarOpeningOffset,
    type MobileSidebarSide,
    type MobileSwipeDirection,
    setSidebarSwipeState,
    shouldCloseGlobalMenu,
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
// 长按进入多选的定时器
let longPressTimer: number;
let longPressBlockElement: HTMLElement;
let longPressTouchRange: Range;

const getSidebarElement = (side: MobileSidebarSide) => {
    return document.getElementById(side === "left" ? "sidebar" : "sidebarRight");
};

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

const getSidebarDock = (sidebarElement: HTMLElement | null) => {
    if (!sidebarElement) {
        return;
    }
    const toolbarElement = sidebarElement.querySelector(".toolbar--border");
    const tabElements = Array.from(toolbarElement?.querySelectorAll<HTMLElement>("[data-type]") || []);
    const activeElement = tabElements.find(item =>
        item.classList.contains("toolbar__icon--active") && !item.classList.contains("fn__none")) ||
        tabElements.find(item => !item.classList.contains("fn__none"));
    const type = activeElement?.dataset.type?.replace(/^sidebar-/, "").replace(/-tab$/, "");
    if (toolbarElement && type) {
        return {toolbarElement, type};
    }
};

const popSidebar = (side: MobileSidebarSide, render = true) => {
    activeBlur();
    const sidebarElement = getSidebarElement(side);
    if (!sidebarElement) {
        return;
    }
    let dock: ReturnType<typeof getSidebarDock>;
    if (render) {
        dock = getSidebarDock(sidebarElement);
        if (!dock) {
            sidebarElement.style.removeProperty("transform");
            closePanel();
            return;
        }
    }
    const otherSidebar = side === "left" ? "right" : "left";
    getSidebarElement(otherSidebar)?.style.removeProperty("transform");
    sidebarElement.style.transform = "translateX(0px)";
    if (render) {
        dock.toolbarElement.dispatchEvent(new CustomEvent("click", {detail: dock.type}));
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
    if (range.collapsed || hasVisibleSelectionText(range.toString()) ||
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
        range.toString(),
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
                editor.protyle.toolbar.subElement.querySelector(".multiSelectCount").textContent =
                    editor.protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").length.toString();
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

    let scrollEnable = false;
    if (Date.now() - time < 1000) {
        scrollEnable = true;
    } else if (Math.abs(xDiff) > window.innerWidth / 3) {
        scrollEnable = true;
    }

    if (targetSidebar) {
        if (isXScroll && getOpenSidebarReleaseAction(targetSidebar, firstDirection, reversing) === "close") {
            closePanel();
        } else {
            popSidebar(targetSidebar, false);
        }
        return;
    }
    if (!scrollEnable || !isXScroll) {
        closePanel();
        return;
    }

    if (reversing) {
        closePanel();
    } else {
        popSidebar(getOpeningSidebar(firstDirection));
    }
};

export const handleTouchStart = (event: TouchEvent) => {
    updateSidebarSwipeState();
    time = Date.now();
    longPressBlockElement = undefined;
    longPressTouchRange = undefined;
    const target = event.touches[0].target as HTMLElement;
    if (0 < event.touches.length && (target.tagName === "VIDEO" || target.tagName === "AUDIO")) {
        // https://github.com/siyuan-note/siyuan/issues/14569
        activeBlur();
        return;
    }
    // 可滚动面板内容优先处理原生滚动，避免斜向滑动触发侧栏关闭
    if (hasClosestByAttribute(target, "data-prevent-swipe", null, true)) {
        clientX = null;
        clientY = null;
        return;
    }
    // 存在其他拖拽元素时
    const otherTouchElement = hasClosestByClassName(target, "b3-chip");
    if ((otherTouchElement && otherTouchElement.parentElement.classList.contains("b3-chips__doctag")) ||
        target.closest(".protyle-gutters") ||
        target.closest(".protyle-action") ||
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

    firstDirection = null;
    xDiff = undefined;
    yDiff = undefined;
    lastClientX = undefined;
    firstXY = undefined;
    previousClientX = undefined;
    if (isIPhone() ||
        (event.touches[0].clientX > 8 && event.touches[0].clientX < window.innerWidth - 8)) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    } else {
        clientX = null;
        clientY = null;
        event.stopImmediatePropagation();
    }
    isFirstMove = true;
    scrollBlock = false;
    // 长按编辑器内块达到阈值时直接进入多选模式，无需抬手
    clearLongPress();
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
                    if (!range.collapsed && hasVisibleSelectionText(range.toString()) &&
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
        if (range.toString() !== "" && currentEditor?.protyle.wysiwyg.element.contains(range.startContainer)) {
            return;
        }
    }

    xDiff = Math.floor(clientX - event.touches[0].clientX);
    yDiff = Math.floor(clientY - event.touches[0].clientY);
    // 上下滚动防止左右滑动
    if (!firstXY) {
        firstXY = getTouchAxis(xDiff, yDiff, Constants.SIZE_DRAG_THRESHOLD);
        if (!firstXY) {
            return;
        }
        firstDirection = xDiff > 0 ? "toLeft" : "toRight";
        if (firstXY === "x") {
            const targetSidebar = getTargetSidebar(target);
            const menuElement = hasClosestByAttribute(target, "id", "menu", true);
            if ((menuElement && !shouldCloseGlobalMenu(firstDirection, false)) ||
                (targetSidebar && !shouldDragOpenSidebar(targetSidebar, firstDirection))) {
                firstXY = "y";
                yDiff = undefined;
            }
        }
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
