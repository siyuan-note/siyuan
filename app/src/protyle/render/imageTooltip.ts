import {escapeHtml} from "../../util/escape";
import {getAssetExtension, getAssetName} from "../../util/pathName";
import {getImageTitle} from "./imageTitle";

const getOCRPreview = (text: string) => {
    const content = text.trim().replace(/\r\n|\r/g, "\n");
    let preview = "";
    let length = 0;
    let lines = 1;
    for (const character of content) {
        if (length === 200 || character === "\n" && lines === 6) {
            return preview.trimEnd() + "...";
        }
        preview += character;
        length++;
        if (character === "\n") {
            lines++;
        }
    }
    return preview;
};

export const getImageTooltip = (image: HTMLImageElement, size?: string, ocrText?: string) => {
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
    const descriptions = [getImageTitle(image), image.alt].filter(value => value && value !== nameWithoutExtension);
    const text = Array.from(new Set([name, ...descriptions].filter(Boolean)))
        .map(value => escapeHtml(value)).join("<br>");
    const format = /^data:image\/([\w.+-]+)/.exec(source)?.[1].replace(/\+xml$/, "").toUpperCase() ||
        extension.substring(1).toUpperCase();
    // 原始尺寸不受编辑器缩放和图片排版宽度影响。
    const dimensions = image.naturalWidth && image.naturalHeight ? `${image.naturalWidth} × ${image.naturalHeight}` : "";
    const information = [format, dimensions, size].filter(Boolean).map(value => escapeHtml(value)).join(" · ");
    const tooltip = text + (text && information ? '<div class="fn__hr"></div>' : "") + information;
    if (ocrText === undefined) {
        return tooltip;
    }
    const ocr = escapeHtml(getOCRPreview(ocrText) || window.siyuan.languages.emptyContent).replace(/\n/g, "<br>");
    return tooltip + '<div class="fn__hr"></div>' + escapeHtml(window.siyuan.languages.ocrResult) + ":<br>" + ocr;
};
