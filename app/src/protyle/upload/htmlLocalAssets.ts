export interface IHTMLLocalAsset {
    element: Element;
    attribute: "href" | "src";
    path: string;
}

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
        (["href", "src"] as const).forEach(attribute => {
            const path = element.getAttribute(attribute);
            if (path && isHTMLLocalAssetPath(path)) {
                assets.push({element, attribute, path});
            }
        });
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
