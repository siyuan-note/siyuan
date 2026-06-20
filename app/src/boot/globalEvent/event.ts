import {App} from "../../index";
import {windowMouseMove} from "./mousemove";
import {windowKeyUp} from "./keyup";
import {windowKeyDown} from "./keydown";
import {globalClick} from "./click";
import {goBack, goForward} from "../../util/backForward";
import {Constants} from "../../constants";
import {isIPad} from "../../protyle/util/compatibility";
import {hasClosestByClassName, isInEmbedBlock} from "../../protyle/util/hasClosest";
import {hideTooltip} from "../../dialog/tooltip";
import {hideAllElements} from "../../protyle/ui/hideElements";
import {dragOverScroll, stopScrollAnimation} from "./dragover";
import {setWebViewFocusable} from "../../mobile/util/mobileAppUtil";
import {initTouchDragBridge} from "../../util/touchDragBridge";

export const initWindowEvent = (app: App) => {
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
        if (event.dataTransfer.types.includes("text/plain")) {
            return;
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
        if (hasClosestByClassName(event.target, "layout-tab-container__drag") ||
            event.dataTransfer.types.includes(Constants.SIYUAN_DROP_TAB)) {
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
    document.addEventListener("touchstart", (event) => {
        time = Date.now();
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
        if (window.siyuan.touchDragActive) {
            return;
        }
        // pad 端长按事件
        const currentTime = Date.now();
        if (isIPad() && currentTime - time > 900 && currentTime - time < 2000) {
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
