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

export const getImageTooltip = (image: HTMLImageElement, size?: string, ocrText?: string, ocrFailed = false) => {
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
    let tooltip = text + (text && information ? "<br>" : "") + information;
    const config = window.siyuan.config.ocr;
    const append = (content: string) => {
        tooltip += (tooltip ? "<br>" : "") + content;
    };
    if (ocrFailed && config?.showError) {
        append(escapeHtml(window.siyuan.languages.ocrFailed));
    }
    const preview = ocrText === undefined ? "" : getOCRPreview(ocrText);
    if (!preview) {
        if (ocrText !== undefined && !ocrFailed && config?.showEmpty) {
            append(escapeHtml(window.siyuan.languages.ocrNoText));
        }
        return tooltip;
    }
    if (config?.showText === false) {
        return tooltip;
    }
    const ocr = escapeHtml(preview).replace(/\n/g, "<br>");
    append(escapeHtml(window.siyuan.languages.ocrResult) + ":<br>" + ocr);
    return tooltip;
};
