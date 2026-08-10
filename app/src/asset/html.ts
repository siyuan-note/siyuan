export const isHTMLFilePath = (value: string) => {
    const path = value.split(/[?#]/, 1)[0].toLowerCase();
    return path.endsWith(".html") || path.endsWith(".htm");
};

export const isLocalHTMLAssetPath = (value: string) => {
    const path = value.split(/[?#]/, 1)[0];
    const normalizedPath = path.startsWith("./") ? path.substring(2) : path;
    return (normalizedPath.startsWith("assets/") || normalizedPath.startsWith("/assets/")) &&
        isHTMLFilePath(normalizedPath);
};

export const getHTMLAssetIFrameSrc = (assetPath: string) => {
    if (!isLocalHTMLAssetPath(assetPath)) {
        return assetPath;
    }
    const hashIndex = assetPath.indexOf("#");
    const hash = hashIndex > -1 ? assetPath.substring(hashIndex) : "";
    const pathAndQuery = hashIndex > -1 ? assetPath.substring(0, hashIndex) : assetPath;
    const queryIndex = pathAndQuery.indexOf("?");
    const path = queryIndex > -1 ? pathAndQuery.substring(0, queryIndex) : pathAndQuery;
    const params = new URLSearchParams(queryIndex > -1 ? pathAndQuery.substring(queryIndex + 1) : "");
    params.set("iframe", "true");
    return `${path}?${params.toString()}${hash}`;
};
