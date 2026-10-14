import {isInIOS} from "../protyle/util/compatibility";
import {bindTouchActivation} from "./touchActivation";

let initialized = false;

export const isTouchHoverInput = () => document.body.classList.contains("body--touch-input");

// 按实际输入切换悬停行为，触屏设备连接鼠标后仍可恢复鼠标提示和工具栏显隐。
export const initHoverInput = () => {
    if (initialized) {
        return;
    }
    initialized = true;
    if (isInIOS()) {
        bindTouchActivation(window);
    }
    document.body.classList.toggle("body--touch-input", window.matchMedia("(hover: none)").matches);
    const update = (event: PointerEvent) => {
        if (["mouse", "touch", "pen"].includes(event.pointerType)) {
            document.body.classList.toggle("body--touch-input", event.pointerType === "touch");
        }
    };
    ["pointerover", "pointerdown", "pointermove"].forEach(type => {
        document.addEventListener(type, update, {capture: true, passive: true});
    });
};
