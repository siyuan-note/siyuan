export const isMobile = () => {
    return !document.getElementById("dockBottom");
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

export const getSearch: (key: string, link?: string) => string | null = (key: string, link = window.location.search) => {
    // REF https://developer.mozilla.org/zh-CN/docs/Web/API/URLSearchParams
    const urlSearchParams = new URLSearchParams(link);
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

// REF https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/eval
export const looseJsonParse = (text: string) => {
    return Function(`"use strict";return (${text})`)();
};
