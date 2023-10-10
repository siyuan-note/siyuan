export const isMobile = () => {
    return document.getElementById("sidebar") ? true : false;
};

// "windows" | "linux" | "darwin" | "docker" | "android" | "ios"
export const getBackend = () => {
    if (["docker", "ios", "android"].includes(window.siyuan.config.system.container)) {
        return window.siyuan.config.system.container;
    } else {
        return window.siyuan.config.system.os;
    }
};

// "desktop" | "desktop-window" | "mobile" | "browser-desktop" | "browser-mobile"
export const getFrontend = () => {
    /// #if MOBILE
    if (window.navigator.userAgent.startsWith("SiYuan/")) {
        return "mobile";
    } else {
        return "browser-mobile";
    }
    /// #else
    if (window.navigator.userAgent.startsWith("SiYuan/")) {
        if (isWindow()) {
            return "desktop-window";
        }
        return "desktop";
    } else {
        return "browser-desktop";
    }
    /// #endif
};

export const isWindow = () => {
    return document.getElementById("toolbar") ? false : true;
};

export const isTouchDevice = () => {
    return ("ontouchstart" in window) && navigator.maxTouchPoints > 1;
};

export const isArrayEqual = (arr1: string[], arr2: string[]) => {
    return arr1.length === arr2.length && arr1.every((item) => arr2.includes(item));
};

export const getRandom = (min: number, max: number) => {
    return Math.floor(Math.random() * (max - min + 1)) + min; //含最大值，含最小值
};

export const getSearch = (key: string, link = window.location.search) => {
    const params = link.substring(link.indexOf("?"));
    const hashIndex = params.indexOf("#");
    // REF https://developer.mozilla.org/zh-CN/docs/Web/API/URLSearchParams
    const urlSearchParams = new URLSearchParams(params.substring(0, hashIndex >= 0 ? hashIndex : undefined));
    return urlSearchParams.get(key);
};

export const isBrowser = () => {
    /// #if BROWSER
    return true;
    /// #else
    return false;
    /// #endif
};

export const isDynamicRef = (text: string) => {
    return /^\(\(\d{14}-\w{7} '.*'\)\)$/.test(text);
};

export const isFileAnnotation = (text: string) => {
    return /^<<assets\/.+\/\d{14}-\w{7} ".+">>$/.test(text);
};

export const isValidAttrName = (name: string) => {
    return /^[_a-zA-Z][_.\-0-9a-zA-Z]*$/.test(name);
};

// REF https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/eval
export const looseJsonParse = (text: string) => {
    return Function(`"use strict";return (${text})`)();
};

export const objEquals = (a: any, b: any): boolean => {
    if (a === b) return true;
    if (typeof a === "number" && isNaN(a) && typeof b === "number" && isNaN(b)) return true;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (!a || !b || (typeof a !== "object" && typeof b !== "object")) return a === b;
    if (a.prototype !== b.prototype) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every(k => objEquals(a[k], b[k]));
};
