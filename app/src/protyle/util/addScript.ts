export const addScriptElement = (element: HTMLScriptElement, anchorID?: string) => {
    if (anchorID) {
        const anchor = document.getElementById(anchorID);
        if (anchor) {
            anchor.before(element);
            return;
        }
    }
    document.head.append(element);
}

export const addScriptSync = (path: string, id: string, anchorID?: string) => {
    if (document.getElementById(id)) {
        return false;
    }
    const xhrObj = new XMLHttpRequest();
    xhrObj.open("GET", path, false);
    xhrObj.setRequestHeader("Accept",
        "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01");
    xhrObj.send("");
    const scriptElement = document.createElement("script");
    scriptElement.type = "text/javascript";
    scriptElement.text = xhrObj.responseText;
    scriptElement.id = id;
    addScriptElement(scriptElement, anchorID)
};

export const addScript = (path: string, id: string, anchorID?: string) => {
    return new Promise((resolve) => {
        if (document.getElementById(id)) {
            // 脚本加载后再次调用直接返回
            resolve(false);
            return false;
        }
        const scriptElement = document.createElement("script");
        scriptElement.async = true;
        scriptElement.src = path;
        // 循环调用时 Chrome 不会重复请求 js
        addScriptElement(scriptElement, anchorID)
        scriptElement.onload = () => {
            if (document.getElementById(id)) {
                // 循环调用需清除 DOM 中的 script 标签
                scriptElement.remove();
                resolve(false);
                return false;
            }
            scriptElement.id = id;
            resolve(true);
        };
    });
};
