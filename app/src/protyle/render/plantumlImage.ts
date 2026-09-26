// 使用当前渲染载体的地址，兼容远程内核和加载失败后的图片回退。
export const getPlantumlImageURL = (element: Element) => {
    return element.querySelector("object")?.getAttribute("data") ||
        element.querySelector("img")?.getAttribute("src") || "";
};

export const getPlantumlImageBlob = async (element: Element) => {
    const url = getPlantumlImageURL(element);
    if (!url) {
        return;
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    if (!blob.size || !blob.type.startsWith("image/")) {
        throw new Error(window.siyuan.languages.fileTypeError);
    }
    return blob;
};
