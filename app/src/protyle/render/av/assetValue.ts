export const genNetworkImageAssetValue = (content: string): IAVCellAssetValue | undefined => {
    const value = content.trim();
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return;
    }
    return {
        type: "image",
        name: "",
        content: value,
    };
};
