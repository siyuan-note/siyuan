export const addStyle = (url: string, id: string) => {
    if (!document.getElementById(id)) {
        const styleElement = document.createElement("link");
        styleElement.id = id;
        styleElement.rel = "stylesheet";
        styleElement.type = "text/css";
        styleElement.href = url;
        const pluginsStyle = document.querySelector("#pluginsStyle");
        if (pluginsStyle) {
            pluginsStyle.before(styleElement);
        } else {
            document.getElementsByTagName("head")[0].appendChild(styleElement);
        }
    }
};
