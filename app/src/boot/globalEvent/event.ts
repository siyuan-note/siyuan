import {App} from "../../index";
import {windowMouseMove} from "./mousemove";
import {windowKeyUp} from "./keyup";
import {windowKeyDown} from "./keydown";
import {globalClick} from "./click";
import {goBack, goForward} from "../../util/backForward";
import {Constants} from "../../constants";
import {hasClosestByClassName, isInEmbedBlock} from "../../protyle/util/hasClosest";
import {hideTooltip} from "../../dialog/tooltip";
import {hideAllElements} from "../../protyle/ui/hideElements";
import {dragOverScroll, stopScrollAnimation} from "./dragover";
import {setWebViewFocusable} from "../../mobile/util/mobileAppUtil";
import {cancelManualTouch, initTouchDragBridge, isLastPointerMouse} from "../../util/touchDragBridge";
import {isWindow} from "../../util/functions";
import {getDockByType} from "../../layout/tabUtil";
import {fetchPost} from "../../util/fetch";

export const initWindowEvent = (app: App) => {
    let lastEncryptedNotebookTouch = 0;
    const touchEncryptedNotebooks = () => {
        if (window.siyuan.isPublish) {
            return;
        }
        const now = Date.now();
        if (now - lastEncryptedNotebookTouch < 30000) {
            return;
        }
        lastEncryptedNotebookTouch = now;
        fetchPost("/api/notebook/touchEncryptedNotebooks", {});
    };
    window.addEventListener("pointerdown", touchEncryptedNotebooks, {passive: true});
    window.addEventListener("keydown", touchEncryptedNotebooks);
    document.addEventListener("touchstart", touchEncryptedNotebooks, {passive: true});

    document.body.addEventListener("mouseleave", () => {
        if (window.siyuan.layout.leftDock) {
            window.siyuan.layout.leftDock.hideDock();
            window.siyuan.layout.rightDock.hideDock();
            window.siyuan.layout.bottomDock.hideDock();
        }
        document.querySelectorAll(".protyle-gutters").forEach(item => {
            item.classList.add("fn__none");
            item.innerHTML = "";
        });
        hideTooltip();
    });
    let mouseIsEnter = false;
    document.body.addEventListener("mouseenter", () => {
        if (window.siyuan.layout.leftDock) {
            mouseIsEnter = true;
            setTimeout(() => {
                mouseIsEnter = false;
            }, Constants.TIMEOUT_TRANSITION);
        }
    });

    window.addEventListener("mousemove", (event: MouseEvent & { target: HTMLElement }) => {
        windowMouseMove(event, mouseIsEnter);
    });

    // 横向滚动表格时重新定位表格列宽调整手柄 https://github.com/siyuan-note/siyuan/issues/13828
    window.addEventListener("scroll", (event: Event) => {
        const scrollElement = event.target as HTMLElement;
        // 仅处理表格内容容器（.table 块的 firstElementChild）的滚动
        if (!scrollElement.parentElement || !scrollElement.parentElement.classList.contains("table")) {
            return;
        }
        const resizeElement = scrollElement.parentElement.querySelector(".table__resize") as HTMLElement;
        if (!resizeElement) {
            return;
        }
        const baseLeft = resizeElement.getAttribute("data-left");
        const style = resizeElement.getAttribute("style");
        if (baseLeft === null || !style || style.indexOf("display:block") === -1) {
            return;
        }
        const left = parseInt(baseLeft) - scrollElement.scrollLeft;
        resizeElement.setAttribute("style", style.replace(/left: ?-?\d+px;/, `left: ${Math.round(left)}px;`));
    }, true);

    let scrollTarget: HTMLElement | false;
    window.addEventListener("dragover", (event: DragEvent & { target: HTMLElement }) => {
        if (event.dataTransfer.types.includes(Constants.SIYUAN_DROP_TAB)) {
            if (!hasClosestByClassName(event.target, "layout-tab-bar")) {
                stopScrollAnimation();
            }
            return;
        }
        if (event.dataTransfer.types.includes("text/plain")) {
            return;
        }
        // 拖拽标题/列表项块标时，按浮窗模型控制文档树所在浮动 dock 的显隐：
        // 鼠标在边缘触发区或面板内则展开，离开则收起 https://github.com/siyuan-note/siyuan/issues/18043
        if (!isWindow() &&
            (!window.siyuan.layout.leftDock.pin || !window.siyuan.layout.rightDock.pin || !window.siyuan.layout.bottomDock.pin)) {
            const fileDock = getDockByType("file");
            // 文档树所在 dock 为浮动且文档树图标激活时才处理
            if (fileDock && !fileDock.pin &&
                document.querySelector('.dock__items > .dock__item--active[data-type="file"]')) {
                let gutterBlockType = "";
                for (const itemType of event.dataTransfer.types) {
                    if (itemType.startsWith(Constants.SIYUAN_DROP_GUTTER)) {
                        gutterBlockType = itemType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP)[0];
                        break;
                    }
                }
                if (["nodeheading", "nodelistitem"].includes(gutterBlockType)) {
                    const statusHeight = document.getElementById("status")?.clientHeight || 0;
                    const toolbarHeight = document.getElementById("toolbar")?.clientHeight || 0;
                    const inYRange = event.clientY > toolbarHeight && event.clientY < window.innerHeight - statusHeight;
                    // 通过 dock 容器类名判断位置，避免访问私有属性 position
                    const dockElement = fileDock.layout.element;
                    let onEdge = false;
                    if (dockElement.classList.contains("layout__dockl")) {
                        onEdge = inYRange &&
                            (fileDock.elements[0].clientWidth > 0 ? event.clientX < Math.max((document.getElementById("dockLeft")?.clientWidth || 0) + 1, 16) : event.clientX < 8);
                    } else if (dockElement.classList.contains("layout__dockr")) {
                        onEdge = inYRange &&
                            (fileDock.elements[0].clientWidth > 0 ? event.clientX > window.innerWidth - Math.max((document.getElementById("dockRight")?.clientWidth || 0) - 2, 16) : event.clientX > window.innerWidth - 8);
                    } else if (dockElement.classList.contains("layout__dockb")) {
                        onEdge = event.clientY > Math.min(window.innerHeight - 10, window.innerHeight - statusHeight);
                    }
                    const rect = dockElement.getBoundingClientRect();
                    if (onEdge ||
                        (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)) {
                        fileDock.showDock();
                    } else {
                        fileDock.hideDock();
                    }
                }
            }
        }
        const fileElement = hasClosestByClassName(event.target, "sy__file");
        const protyleElement = hasClosestByClassName(event.target, "protyle", true);
        // 光标不在编辑器也不在文档树内时，隐藏拖拽提示（避免卡在无效区域）
        if (!fileElement && !protyleElement) {
            document.querySelector(".drag-tip")?.remove();
            stopScrollAnimation();
            return;
        }
        if (!scrollTarget) {
            scrollTarget = fileElement || protyleElement;
        }
        if (scrollTarget && protyleElement && (
            scrollTarget.classList.contains("sy__file") || protyleElement !== scrollTarget
        )) {
            scrollTarget = protyleElement;
        } else if (scrollTarget && scrollTarget.classList.contains("protyle") && fileElement) {
            scrollTarget = fileElement;
        }
        if (hasClosestByClassName(event.target, "layout-tab-container__drag")) {
            stopScrollAnimation();
            return;
        }
        let scrollElement;
        if (scrollTarget && scrollTarget.classList.contains("sy__file")) {
            scrollElement = scrollTarget.firstElementChild.nextElementSibling;
        } else if (scrollTarget && scrollTarget.classList.contains("protyle")) {
            scrollElement = scrollTarget.querySelector(".protyle-content");
        }
        if (scrollTarget && scrollElement) {
            if ((event.dataTransfer.types.includes(Constants.SIYUAN_DROP_FILE) && hasClosestByClassName(event.target, "layout-tab-bar")) ||
                (event.dataTransfer.types.includes("Files") && scrollTarget.classList.contains("sy__file")) ||
                (scrollTarget.classList.contains("protyle") && hasClosestByClassName(event.target, "dockPanel"))) {
                stopScrollAnimation();
            } else {
                dragOverScroll(event, scrollElement.getBoundingClientRect(), scrollElement);
            }
        } else {
            stopScrollAnimation();
        }
    });
    window.addEventListener("dragend", () => {
        stopScrollAnimation();
        document.querySelector(".drag-tip")?.remove();
        window.siyuan.dragTitle = "";
    });
    window.addEventListener("dragleave", () => {
        stopScrollAnimation();
    });

    window.addEventListener("mouseup", (event) => {
        if (event.button === 3) {
            event.preventDefault();
            goBack(app);
        } else if (event.button === 4) {
            event.preventDefault();
            goForward(app);
        }
    });

    window.addEventListener("mousedown", (event) => {
        // protyle.toolbar 点击空白处时进行隐藏
        if (!hasClosestByClassName(event.target as Element, "protyle-toolbar")) {
            hideAllElements(["toolbar"]);
        }
    });

    window.addEventListener("keyup", (event) => {
        windowKeyUp(app, event);
    });

    window.addEventListener("keydown", (event) => {
        windowKeyDown(app, event);
    });

    window.addEventListener("blur", () => {
        window.siyuan.ctrlIsPressed = false;
        window.siyuan.shiftIsPressed = false;
        window.siyuan.altIsPressed = false;
        document.body.classList.remove("body--shift-pressed");
        /// #if BROWSER
        setWebViewFocusable();
        /// #endif
    });

    window.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
        globalClick(event);
    });

    let time = 0;
    let startX = 0;
    let startY = 0;
    document.addEventListener("touchstart", (event) => {
        time = Date.now();
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
        // https://github.com/siyuan-note/siyuan/issues/6328
        const target = event.target as HTMLElement;
        if (hasClosestByClassName(target, "protyle-icons") ||
            hasClosestByClassName(target, "item") ||
            target.classList.contains("protyle-background__icon")) {
            return;
        }
        const embedBlockElement = isInEmbedBlock(target);
        if (embedBlockElement) {
            embedBlockElement.firstElementChild.classList.toggle("protyle-icons--show");
            return;
        }
    }, false);

    document.addEventListener("touchend", (event) => {
        // 无条件前置取消手动桥接：触发各组件（如 Outline.bindSort）注册的 mouseup 清理回调，复位 document.onmousemove 等状态
        cancelManualTouch();
        if (window.siyuan.touchDragActive) {
            return;
        }
        if (Math.abs(startX - event.changedTouches[0].clientX) < Constants.SIZE_DRAG_THRESHOLD &&
            Math.abs(startY - event.changedTouches[0].clientY) < Constants.SIZE_DRAG_THRESHOLD &&
            Date.now() - time > Constants.TIMEOUT_LONGPRESS &&
            // 鼠标长按不应合成右键菜单：触屏长按出菜单是手指专属手势，鼠标菜单由右键触发
            !isLastPointerMouse()) {
            event.target.dispatchEvent(new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: event.changedTouches[0].clientX,
                clientY: event.changedTouches[0].clientY,
            }));
            event.stopImmediatePropagation();
            event.preventDefault();
        }
    });
    initTouchDragBridge();
};
