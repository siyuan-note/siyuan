import {App} from "../../index";
import {windowMouseMove} from "./mousemove";
import {windowKeyUp} from "./keyup";
import {windowKeyDown} from "./keydown";
import {globalClick} from "./click";
import {goBack, goForward} from "../../util/backForward";
import {Constants} from "../../constants";
import {isIPad} from "../../protyle/util/compatibility";
import {globalTouchEnd} from "./touch";
import {initDockMenu} from "../../menus/dock";
import {hasClosestByAttribute, hasClosestByClassName} from "../../protyle/util/hasClosest";
import {initTabMenu} from "../../menus/tab";
import {getInstanceById} from "../../layout/util";
import {Tab} from "../../layout/Tab";
import {hideTooltip} from "../../dialog/tooltip";

export const initWindowEvent = (app: App) => {
    document.body.addEventListener("mouseleave", () => {
        if (window.siyuan.layout.leftDock) {
            window.siyuan.layout.leftDock.hideDock();
            window.siyuan.layout.rightDock.hideDock();
            window.siyuan.layout.bottomDock.hideDock();
        }
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

    if (isIPad()) {
        let time = 0;
        document.addEventListener("touchstart", () => {
            time = new Date().getTime();
        }, false);
        document.addEventListener("touchend", (event) => {
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
        }, false);
    }
};
