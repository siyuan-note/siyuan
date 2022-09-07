export const isMobile = () => {
    return !document.getElementById("dockBottom");
};

export const getRandom = (min: number, max: number) => {
    return Math.floor(Math.random() * (max - min + 1)) + min; //含最大值，含最小值
};

export const getSearch = (key: string, link = window.location.search) => {
    if (link.indexOf("?") === -1) {
        return "";
    }
    let value = "";
    const data = link.split("?")[1].split("&");
    data.find(item => {
        const keyValue = item.split("=");
        if (keyValue[0] === key) {
            value = keyValue[1];
            return true;
        }
    });
    return value;
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
