import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasTopClosestByClassName,
    isInEmbedBlock,
} from "../../protyle/util/hasClosest";
import {closeModel, closePanel} from "./closePanel";
import {popMenu} from "../menu";
import {activeBlur} from "./keyboardToolbar";
import {isChromeBrowser, isInAndroid, isInHarmony, isIPhone} from "../../protyle/util/compatibility";
import {getRangeByPoint} from "../../protyle/util/selection";
import {getCurrentEditor} from "../editor";
import {Constants} from "../../constants";
import {getEmbedChildOperationContext} from "../../protyle/wysiwyg/getBlock";

let clientX: number;
let clientY: number;
let xDiff: number;
let yDiff: number;
let time: number;
let firstDirection: "toLeft" | "toRight";
let firstXY: "x" | "y";
let lastClientX: number;    // 和起始方向不一致时，记录最后一次的 clientX
let scrollBlock: boolean;
let isFirstMove = true;
// 长按进入多选的定时器
let longPressTimer: number;

const popSide = (render = true) => {
    if (render) {
        document.getElementById("toolbarFile").dispatchEvent(new CustomEvent("click"));
    } else {
        activeBlur();
        document.getElementById("sidebar").style.transform = "translateX(0px)";
    }
};

// 清除长按进入多选的定时器
const clearLongPress = () => {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = undefined;
    }
};

export const handleTouchUp = () => {
    if (Date.now() - time < Constants.TIMEOUT_MULTIPLE_SELECT) {
        clearLongPress();
    }
};

export const handleTouchEnd = (event: TouchEvent) => {
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
            const blockElement = hasClosestBlock(target);
            if (blockElement) {
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
                    getEmbedChildOperationContext(nodeElement) ? nodeElement : embedElement, target);
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

    if (scrollBlock) {
        closePanel();
        return;
    }

    let scrollEnable = false;
    if (Date.now() - time < 1000) {
        scrollEnable = true;
    } else if (Math.abs(xDiff) > window.innerWidth / 3) {
        scrollEnable = true;
    }

    const isXScroll = Math.abs(xDiff) > Math.abs(yDiff);
    const modelElement = hasClosestByAttribute(target, "id", "model", true);
    if (modelElement) {
        if (isXScroll && firstDirection === "toRight" && !lastClientX && !hasClosestByClassName(target, "protyle-wysiwyg", true) &&
            // 划选文字时不触发关闭面板
            (getSelection().rangeCount === 0 || getSelection().toString() === "")) {
            closeModel();
        }
        return;
    }
    const menuElement = hasClosestByAttribute(target, "id", "menu");
    if (menuElement) {
        if (isXScroll) {
            if (firstDirection === "toRight") {
                if (lastClientX) {
                    popMenu();
                } else {
                    closePanel();
                }
            } else {
                if (lastClientX) {
                    closePanel();
                } else {
                    popMenu();
                }
            }
        } else {
            popMenu();
        }
        return;
    }
    const sideElement = hasClosestByAttribute(target, "id", "sidebar");
    if (sideElement) {
        if (isXScroll) {
            if (firstDirection === "toLeft") {
                if (lastClientX) {
                    popSide(false);
                } else {
                    closePanel();
                }
            } else {
                if (lastClientX) {
                    closePanel();
                } else {
                    popSide(false);
                }
            }
        } else {
            popSide(false);
        }
        return;
    }
    if (!scrollEnable || !isXScroll) {
        closePanel();
        return;
    }

    if (xDiff > 0) {
        if (lastClientX) {
            closePanel();
        } else {
            popMenu();
        }
    } else {
        if (lastClientX) {
            closePanel();
        } else {
            popSide();
        }
    }
};

export const handleTouchStart = (event: TouchEvent) => {
    time = Date.now();
    const target = event.touches[0].target as HTMLElement;
    if (0 < event.touches.length && (target.tagName === "VIDEO" || target.tagName === "AUDIO")) {
        // https://github.com/siyuan-note/siyuan/issues/14569
        activeBlur();
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
        if (blockElement && editor.protyle.wysiwyg.element.contains(blockElement)) {
            longPressTimer = window.setTimeout(() => {
                window.getSelection()?.removeAllRanges();
                editor.protyle.toolbar.showMultiSelectMode(editor.protyle, blockElement);
                if (editor.protyle.options.render.gutter) {
                    editor.protyle.gutter.render(editor.protyle, blockElement, target);
                }
            }, Constants.TIMEOUT_MULTIPLE_SELECT);
        }
    }
};

let previousClientX: number;
const sideMaskElement = document.querySelector(".side-mask") as HTMLElement;
export const handleTouchMove = (event: TouchEvent) => {
    const target = event.target as HTMLElement;
    // 位移超过阈值说明是滑动而非长按，取消进入多选的定时器
    if (clientX && clientY &&
        (Math.abs(clientX - event.touches[0].clientX) >= 5 || Math.abs(clientY - event.touches[0].clientY) >= 5)) {
        clearLongPress();
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
    if (!firstDirection) {
        firstDirection = xDiff > 0 ? "toLeft" : "toRight";
    }
    // 上下滚动防止左右滑动
    if (!firstXY) {
        if (Math.abs(xDiff) > Math.abs(yDiff)) {
            firstXY = "x";
        } else {
            firstXY = "y";
        }
        if (firstXY === "x") {
            if ((hasClosestByAttribute(target, "id", "menu") && firstDirection === "toLeft") ||
                (hasClosestByAttribute(target, "id", "sidebar") && firstDirection === "toRight")) {
                firstXY = "y";
                yDiff = undefined;
            }
        }
    }
    if (previousClientX) {
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
            return;
        }
        if (sideMaskElement.classList.contains("fn__none")) {
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
            sideMaskElement.style.zIndex = (++window.siyuan.zIndex).toString();
            document.getElementById("sidebar").style.zIndex = (++window.siyuan.zIndex).toString();
            document.getElementById("menu").style.zIndex = (++window.siyuan.zIndex).toString();
            isFirstMove = false;
        }
        const windowWidth = window.innerWidth;
        const menuElement = hasClosestByAttribute(target, "id", "menu");
        if (menuElement) {
            if (xDiff < 0) {
                menuElement.style.transform = `translateX(${-xDiff}px)`;
                transformMask(-xDiff / windowWidth);
            } else {
                menuElement.style.transform = "translateX(0px)";
                transformMask(0);
            }
            return;
        }
        const sideElement = hasClosestByAttribute(target, "id", "sidebar");
        if (sideElement) {
            if (xDiff > 0) {
                sideElement.style.transform = `translateX(${-xDiff}px)`;
                transformMask(xDiff / windowWidth);
            } else {
                sideElement.style.transform = "translateX(0px)";
                transformMask(0);
            }
            return;
        }

        if (firstDirection === "toRight") {
            document.getElementById("sidebar").style.transform = `translateX(${Math.min(-xDiff - windowWidth, 0)}px)`;
            transformMask((windowWidth + xDiff) / windowWidth);
        } else {
            document.getElementById("menu").style.transform = `translateX(${Math.max(windowWidth - xDiff, 0)}px)`;
            transformMask((windowWidth - xDiff) / windowWidth);
        }
        activeBlur();
        if (window.siyuan.mobile.editor) {
            window.siyuan.mobile.editor.protyle.contentElement.style.overflow = "hidden";
        }
    }
};

const transformMask = (opacity: number) => {
    sideMaskElement.classList.remove("fn__none");
    sideMaskElement.style.opacity = Math.min((1 - opacity), 0.68).toString();
};
