import {hasClosestByAttribute, hasClosestByClassName} from "../../protyle/util/hasClosest";

export const callMobileAppShowKeyboard = () => {
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