export interface IHTMLLocalAsset {
    element: Element;
    attribute: "href" | "src";
    path: string;
}

const getAssetAttribute = (element: Element): "href" | "src" | undefined => {
    switch (element.tagName.toLowerCase()) {
        case "a":
            return "href";
        case "img":
        case "audio":
        case "video":
        case "source":
            return "src";
    }
};

export const getHTMLAssetSourceURL = (html: string, baseHref?: string) => {
    const source = html.match(/^SourceURL:\s*(\S+)/mi)?.[1];
    try {
        const url = baseHref ? new URL(baseHref, source) : new URL(source);
        return /^https?:$/.test(url.protocol) ? url.href : undefined;
    } catch (_error) {
        return undefined;
    }
};

export const resolveHTMLAssetURL = (value: string, sourceURL?: string) => {
    const path = value.trim();
    // 明确的本地路径、思源资源和页内锚点不按网页来源展开。
    if (!sourceURL || !path || /^(?:[a-z][a-z\d+.-]*:|\\\\|assets\/|#)/i.test(path)) {
        return value;
    }
    try {
        const source = new URL(sourceURL);
        return /^https?:$/.test(source.protocol) ? new URL(path, source).href : value;
    } catch (_error) {
        return value;
    }
};

export const resolveHTMLAssetURLs = (root: ParentNode, sourceURL?: string) => {
    if (!sourceURL) {
        return;
    }
    root.querySelectorAll("[href], [src]").forEach(element => {
        const attribute = getAssetAttribute(element);
        const value = attribute && element.getAttribute(attribute);
        if (value) {
            element.setAttribute(attribute, resolveHTMLAssetURL(value, sourceURL));
        }
    });
};

export const isHTMLLocalAssetPath = (value: string) => {
    const path = value.trim();
    if (!path || path.toLowerCase().startsWith("assets/")) {
        return false;
    }
    if (/^file:\/\//i.test(path) || /^\\\\/.test(path) || /^[a-z]:[\\/]/i.test(path)) {
        return true;
    }
    return path.startsWith("/") && !path.startsWith("//");
};

export const collectHTMLLocalAssets = (root: ParentNode) => {
    const assets: IHTMLLocalAsset[] = [];
    root.querySelectorAll("[href], [src]").forEach(element => {
        const attribute = getAssetAttribute(element);
        const path = attribute && element.getAttribute(attribute);
        if (path && isHTMLLocalAssetPath(path)) {
            assets.push({element, attribute, path});
        }
    });
    return assets;
};

export const applyHTMLLocalAssetPaths = (assets: IHTMLLocalAsset[], paths: Array<string | undefined>) => {
    paths.forEach((path, index) => {
        const asset = assets[index];
        if (asset && path) {
            asset.element.setAttribute(asset.attribute, path);
        }
    });
};

export const removeHTMLLocalAssetPaths = (assets: IHTMLLocalAsset[]) => {
    assets.forEach((asset) => asset.element.removeAttribute(asset.attribute));
};
