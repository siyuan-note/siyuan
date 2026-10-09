import {escapeHtml} from "../../util/escape";
import {getAssetExtension, getAssetName} from "../../util/pathName";

export const getImageTooltip = (image: HTMLImageElement, size?: string) => {
    const source = image.getAttribute("data-src") || image.getAttribute("src") || "";
    const path = source.split(/[?#]/)[0];
    const inline = /^(data|blob):/.test(path);
    const extension = inline ? "" : getAssetExtension(path);
    let name = inline ? "" : getAssetName(path) + extension;
    try {
        name = decodeURIComponent(name);
    } catch (error) {
        // 非 URL 编码的文件名保留原文。
    }
    const nameWithoutExtension = extension ? name.substring(0, name.lastIndexOf(".")) : name;
    const descriptions = [image.title, image.alt].filter(value => value && value !== nameWithoutExtension);
    const text = Array.from(new Set([name, ...descriptions].filter(Boolean)))
        .map(value => escapeHtml(value)).join("<br>");
    const format = /^data:image\/([\w.+-]+)/.exec(source)?.[1].replace(/\+xml$/, "").toUpperCase() ||
        extension.substring(1).toUpperCase();
    // 原始尺寸不受编辑器缩放和图片排版宽度影响。
    const dimensions = image.naturalWidth && image.naturalHeight ? `${image.naturalWidth} × ${image.naturalHeight}` : "";
    const information = [format, dimensions, size].filter(Boolean).map(value => escapeHtml(value)).join(" · ");
    return text + (text && information ? '<div class="fn__hr"></div>' : "") + information;
};
