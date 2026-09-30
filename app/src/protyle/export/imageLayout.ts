const MAX_IMAGE_SIZE = 16384;
// 限制位图面积，避免单个 RGBA 画布占用超过 256 MiB。
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;

export const updateExportImageLayout = (imageElement: HTMLElement) => {
    const scrollElement = imageElement.parentElement;
    const scrollLeft = scrollElement.scrollLeft;
    imageElement.style.minWidth = "";
    const previewElement = imageElement.querySelector<HTMLElement>(".protyle-wysiwyg");
    const overflowWidth = Math.max(0, previewElement.scrollWidth - previewElement.clientWidth);
    if (overflowWidth > 0) {
        imageElement.style.minWidth = `${Math.ceil(imageElement.getBoundingClientRect().width + overflowWidth)}px`;
    }
    scrollElement.scrollLeft = scrollLeft;
};

export const getExportImageSize = (contentElement: HTMLElement) => {
    const imageElement = contentElement.querySelector<HTMLElement>(".export-img");
    const style = getComputedStyle(contentElement);
    const imageStyle = getComputedStyle(imageElement);
    const borderWidth = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    const borderHeight = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    return {
        width: Math.ceil(Math.max(contentElement.clientWidth, imageElement.getBoundingClientRect().width +
            parseFloat(imageStyle.marginLeft) + parseFloat(imageStyle.marginRight) +
            parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)) + borderWidth),
        height: Math.ceil(imageElement.getBoundingClientRect().height +
            parseFloat(imageStyle.marginTop) + parseFloat(imageStyle.marginBottom) +
            parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + borderHeight),
    };
};

export const isExportImageSizeSupported = (size: {width: number, height: number}, pixelRatio: number) => {
    const width = Math.ceil(size.width * pixelRatio);
    const height = Math.ceil(size.height * pixelRatio);
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 &&
        width <= MAX_IMAGE_SIZE && height <= MAX_IMAGE_SIZE && width * height <= MAX_IMAGE_PIXELS;
};
