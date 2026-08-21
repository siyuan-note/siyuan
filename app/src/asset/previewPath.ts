export const getAssetsPreviewPath = (pathString: string, dataPath?: string) => {
    if (!dataPath) {
        return pathString;
    }
    return `${pathString}${pathString.includes("?") ? "&" : "?"}dataPath=${encodeURIComponent(dataPath)}`;
};
