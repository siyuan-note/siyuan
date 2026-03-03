import {hasClosestByAttribute, hasClosestByClassName} from "../../protyle/util/hasClosest";

export let keyboardLockUntil = 0;

export const callMobileAppShowKeyboard = () => {
    // 某些机型（比如鸿蒙 Pura X）在弹起键盘后会立即触发 activeBlur 导致键盘被关闭，所以在主动唤起键盘时锁定一段时间，禁止 activeBlur 关闭键盘
    // 每次主动唤起键盘时，锁定接下来的 200ms 不允许通过 activeBlur 关闭
    keyboardLockUntil = Date.now() + 200;

    if (window.JSAndroid && window.JSAndroid.showKeyboard) {
        window.JSAndroid.showKeyboard();
    } else if (window.JSHarmony && window.JSHarmony.showKeyboard) {
        window.JSHarmony.showKeyboard();
    }
};


export const canInput = (element: Element) => {
    if (!element || element.nodeType !== 1) {
        return false;
    }
    if ((
        element.tagName === "TEXTAREA" ||
        (element.tagName === "INPUT" && ["email", "number", "password", "search", "tel", "text", "url", "", null].includes(element.getAttribute("type")))
    ) && element.getAttribute("readonly") !== "readonly") {
        return element;
    }
    const wysisygElement = hasClosestByClassName(element, "protyle-wysiwyg", true);
    if (wysisygElement && wysisygElement.getAttribute("data-readonly") === "false") {
        return hasClosestByAttribute(element, "contenteditable", "true");
    }
    return false;
};