export const addStyleElement = (element: HTMLLinkElement | HTMLStyleElement, anchorID?: string) => {
    if (anchorID) {
        const anchor = document.getElementById(anchorID);
        if (anchor) {
            anchor.before(element);
            return;
        }
    }
    document.head.append(element);
}

export const addStyle = (url: string, id: string, anchorID?: string) => {
    if (!document.getElementById(id)) {
        const styleElement = document.createElement("link");
        styleElement.rel = "stylesheet";
        styleElement.type = "text/css";
        styleElement.href = url;
        styleElement.id = id;
        addStyleElement(styleElement, anchorID);
    }
};
