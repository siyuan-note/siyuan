import {hasClosestByAttribute, hasClosestByClassName} from "../../protyle/util/hasClosest";

export let keyboardLockUntil = 0;

export const armKeyboardLock = () => {
    // 某些机型（比如鸿蒙 Pura X）在弹起键盘后会立即触发 activeBlur 导致键盘被关闭；移动端浏览器（比如三星键盘）在编辑器获得焦点后也会触发 resize，
    // 进而立即关闭键盘。因此主动唤起键盘或点击可编辑区域时，锁定接下来的一段时间，禁止 activeBlur 关闭键盘
    keyboardLockUntil = Date.now() + 500;
};

export const callMobileAppShowKeyboard = () => {
    armKeyboardLock();

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
    const wysiwygElement = hasClosestByClassName(element, "protyle-wysiwyg", true);
    if (wysiwygElement && wysiwygElement.getAttribute("data-readonly") === "false") {
        return hasClosestByAttribute(element, "contenteditable", "true");
    }
    return false;
};

export const setWebViewFocusable = () => {
    if ((window.JSAndroid || window.JSHarmony) && document.activeElement.tagName === "IFRAME") {
        if (window.JSAndroid?.setWebViewFocusable) {
            window.JSAndroid.setWebViewFocusable(true);
        } else if (window.JSHarmony?.setWebViewFocusable) {
            window.JSHarmony.setWebViewFocusable(true);
        }
    }
};
