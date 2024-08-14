import {App} from "../../index";
import {windowMouseMove} from "./mousemove";
import {windowKeyUp} from "./keyup";
import {windowKeyDown} from "./keydown";
import {globalClick} from "./click";
import {goBack, goForward} from "../../util/backForward";
import {Constants} from "../../constants";
import {isIPad} from "../../protyle/util/compatibility";
import {globalTouchEnd, globalTouchStart} from "./touch";
import {initDockMenu} from "../../menus/dock";
import {
    hasClosestByAttribute,
    hasClosestByClassName,
    isInEmbedBlock
} from "../../protyle/util/hasClosest";
import {initTabMenu} from "../../menus/tab";
import {getInstanceById} from "../../layout/util";
import {Tab} from "../../layout/Tab";
import {hideTooltip} from "../../dialog/tooltip";
import {openFileById} from "../../editor/util";
import {checkFold} from "../../util/noRelyPCFunction";

export const initWindowEvent = (app: App) => {
    document.body.addEventListener("mouseleave", () => {
        if (window.siyuan.layout.leftDock) {
            window.siyuan.layout.leftDock.hideDock();
            window.siyuan.layout.rightDock.hideDock();
            window.siyuan.layout.bottomDock.hideDock();
        }
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

    window.addEventListener("mouseup", (event) => {
        if (event.button === 3) {
            event.preventDefault();
            goBack(app);
        } else if (event.button === 4) {
            event.preventDefault();
            goForward(app);
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
    });

    window.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
        globalClick(event);
    });

    let time = 0;
    document.addEventListener("touchstart", (event) => {
        time = new Date().getTime();
        // https://github.com/siyuan-note/siyuan/issues/6328
        const target = event.target as HTMLElement;
        if (hasClosestByClassName(target, "protyle-icons") ||
            hasClosestByClassName(target, "item") ||
            target.classList.contains("protyle-background__icon")) {
            return;
        }
        // 触摸屏背景和嵌入块按钮显示
        const backgroundElement = hasClosestByClassName(target, "protyle-background");
        if (backgroundElement) {
            if (!globalTouchStart(event)) {
                backgroundElement.classList.toggle("protyle-background--mobileshow");
            }
            return;
        }
        const embedBlockElement = isInEmbedBlock(target);
        if (embedBlockElement) {
            embedBlockElement.firstElementChild.classList.toggle("protyle-icons--show");
            return;
        }
    }, false);
    document.addEventListener("touchend", (event) => {
        if (isIPad()) {
            // https://github.com/siyuan-note/siyuan/issues/9113
            if (globalTouchEnd(event, undefined, time, app)) {
                event.stopImmediatePropagation();
                event.preventDefault();
                return;
            }
            if (new Date().getTime() - time <= 900) {
                return;
            }
            const target = event.target as HTMLElement;
            // dock right menu
            const dockElement = hasClosestByClassName(target, "dock__item");
            if (dockElement && dockElement.getAttribute("data-type")) {
                const dockRect = dockElement.getBoundingClientRect();
                initDockMenu(dockElement).popup({x: dockRect.right, y: dockRect.top});
                event.stopImmediatePropagation();
                event.preventDefault();
                return;
            }

            // tab right menu
            const tabElement = hasClosestByAttribute(target, "data-type", "tab-header");
            if (tabElement) {
                const tabRect = tabElement.getBoundingClientRect();
                initTabMenu(app, (getInstanceById(tabElement.getAttribute("data-id")) as Tab)).popup({
                    x: tabRect.left,
                    y: tabRect.bottom
                });
                hideTooltip();
                event.stopImmediatePropagation();
                event.preventDefault();
                return;
            }

            const backlinkBreadcrumbItemElement = hasClosestByClassName(target, "protyle-breadcrumb__item");
            if (backlinkBreadcrumbItemElement) {
                const breadcrumbId = backlinkBreadcrumbItemElement.getAttribute("data-id") || backlinkBreadcrumbItemElement.getAttribute("data-node-id");
                if (breadcrumbId) {
                    checkFold(breadcrumbId, (zoomIn) => {
                        openFileById({
                            app,
                            id: breadcrumbId,
                            action: zoomIn ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                            zoomIn,
                        });
                        window.siyuan.menus.menu.remove();
                    });
                }
                event.stopImmediatePropagation();
                event.preventDefault();
                return;
            }
        }
    }, false);
};
