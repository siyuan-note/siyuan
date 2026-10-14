import {Constants} from "../constants";

const controls = "button, [role=button], [role=tab], a[href], label, input[type=checkbox], input[type=radio], " +
    "input[type=button], input[type=submit], input[type=reset], .b3-button, .b3-menu__item, .b3-list-item, " +
    ".block__icon, .toolbar__item, .toolbar__icon, .dock__item, .b3-dialog__close, .layout-tab-bar .item, " +
    ".protyle-breadcrumb__item, .b3-dialog__scrim, .b3-menu__scrim";

const getControl = (target: Element) => {
    if (!target) {
        return;
    }
    // 输入、选词和原生选择器交给浏览器，避免菜单容器接管内部表单控件。
    const input = target.closest("input");
    const editable = target instanceof HTMLElement ? target.isContentEditable : target.parentElement?.isContentEditable;
    if (editable || target.closest("textarea, select") ||
        (input && !["checkbox", "radio", "button", "submit", "reset"].includes(input.type))) {
        return;
    }
    const control = target.closest<HTMLElement>(controls);
    if (!control || control.closest("[disabled], [aria-disabled=true], .b3-menu__item--readonly")) {
        return;
    }
    if (control instanceof HTMLLabelElement && control.control &&
        (!(control.control instanceof HTMLInputElement) || !["checkbox", "radio"].includes(control.control.type))) {
        return;
    }
    return control;
};

// iOS 可能只派发悬停而吞掉短按的 click，在触摸处理结束后统一激活共用控件。
export const bindTouchActivation = (view: Window) => {
    let start: {id: number, x: number, y: number, time: number, target: Element, control: HTMLElement};
    const cancel = () => {
        start = undefined;
    };
    view.addEventListener("touchstart", (event: TouchEvent) => {
        cancel();
        if (event.defaultPrevented || event.touches.length !== 1 || !(event.target instanceof Element)) {
            return;
        }
        const control = getControl(event.target);
        if (!control) {
            return;
        }
        const touch = event.touches[0];
        start = {id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp,
            target: event.target, control};
    }, {passive: true});
    view.addEventListener("touchmove", (event: TouchEvent) => {
        const touch = Array.from(event.touches).find(item => item.identifier === start?.id);
        if (!start || event.touches.length !== 1 || !touch ||
            Math.abs(touch.clientX - start.x) >= Constants.SIZE_DRAG_THRESHOLD ||
            Math.abs(touch.clientY - start.y) >= Constants.SIZE_DRAG_THRESHOLD) {
            cancel();
        }
    }, {passive: true});
    view.addEventListener("touchcancel", cancel, {passive: true});
    view.addEventListener("touchend", (event: TouchEvent) => {
        const pressed = start;
        cancel();
        const touch = Array.from(event.changedTouches).find(item => item.identifier === pressed?.id);
        if (!pressed || !touch || event.touches.length || event.defaultPrevented || !event.cancelable ||
            window.siyuan.touchDragActive || !pressed.target.isConnected ||
            event.timeStamp - pressed.time >= Constants.TIMEOUT_LONGPRESS ||
            Math.abs(touch.clientX - pressed.x) >= Constants.SIZE_DRAG_THRESHOLD ||
            Math.abs(touch.clientY - pressed.y) >= Constants.SIZE_DRAG_THRESHOLD ||
            getControl(view.document.elementFromPoint(touch.clientX, touch.clientY)) !== pressed.control) {
            return;
        }
        // window 冒泡阶段位于组件和 document 拖拽清理之后，取消原生兼容点击，避免重复执行。
        event.preventDefault();
        const options = {bubbles: true, cancelable: true, view,
            clientX: touch.clientX, clientY: touch.clientY, button: 0, detail: 1,
            altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey};
        const menuItem = pressed.target.closest(".b3-menu__item");
        if (menuItem) {
            // 桌面布局的子菜单复用悬停加载与展开逻辑，手机布局仍由 click 处理。
            menuItem.dispatchEvent(new MouseEvent("mouseenter", {...options, bubbles: false}));
            pressed.target.dispatchEvent(new MouseEvent("mouseover", options));
        }
        if (pressed.target.isConnected) {
            pressed.target.dispatchEvent(new MouseEvent("click", options));
        }
    }, {passive: false});
};
