const FONT_REFRESH_PARAM = "_fontRefresh";

export const getDynamicIconValue = (src: string): string => {
    const [path, query = ""] = src.split("?", 2);
    const params = new URLSearchParams(query);
    if (!params.has(FONT_REFRESH_PARAM)) {
        return src;
    }
    params.delete(FONT_REFRESH_PARAM);
    const value = params.toString();
    return value ? `${path}?${value}` : path;
};

export const refreshDynamicIcons = () => {
    const revision = Date.now().toString();
    document.querySelectorAll<HTMLImageElement>("img[src]").forEach(image => {
        const src = image.getAttribute("src");
        let url: URL;
        try {
            url = new URL(src, document.baseURI);
        } catch {
            return;
        }
        if (url.origin !== window.location.origin || !url.pathname.endsWith("/api/icon/getDynamicIcon") ||
            url.searchParams.get("type") !== "8") {
            return;
        }
        // 刷新标记仅用于重新请求图片，选择图标时移除，不写入图标属性。
        const value = getDynamicIconValue(src);
        image.setAttribute("src", `${value}${value.includes("?") ? "&" : "?"}${FONT_REFRESH_PARAM}=${revision}`);
    });
};
