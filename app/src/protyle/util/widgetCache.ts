export const addWidgetCacheVersion = (src: string, version: string) => {
    if (!src.startsWith("/widgets/")) {
        return src;
    }

    try {
        const url = new URL(src, "http://127.0.0.1");
        if (!url.pathname.startsWith("/widgets/")) {
            return src;
        }
        url.searchParams.set("siyuan-version", version);
        return url.pathname + url.search + url.hash;
    } catch {
        return src;
    }
};

export const updateWidgetCacheVersion = (root: ParentNode, version: string) => {
    root.querySelectorAll<HTMLIFrameElement>('[data-type="NodeWidget"] iframe').forEach(item => {
        const src = item.getAttribute("src");
        if (src) {
            item.setAttribute("src", addWidgetCacheVersion(src, version));
        }
    });
};
