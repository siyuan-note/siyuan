import {renderAssetsPreview} from "../asset/renderAssets";
import {getAssetsPreviewPath} from "../asset/previewPath";
import {bindPdfTheme, loadPdfViewerModule} from "../asset/pdfViewer";
import {getPdfViewerHTML} from "../asset/pdf/viewerTemplate";
import {Constants} from "../constants";
import {getAssetExtension} from "../util/pathName";
import {isMobile} from "../util/functions";
import {highlightRender} from "../protyle/render/highlightRender";

const TEXT_PREVIEW_LIMIT = 64 * 1024;

export const readAssetPreviewText = async (url: string, signal: AbortSignal) => {
    const response = await fetch(url, {signal, headers: {Range: `bytes=0-${TEXT_PREVIEW_LIMIT}`}});
    if (response.status === 416 && response.headers.get("Content-Range") === "bytes */0") {
        return {text: "", truncated: false};
    }
    if (!response.ok || !response.body) {
        throw new Error("Could not read asset");
    }
    const reader = response.body.getReader();
    const bytes = new Uint8Array(TEXT_PREVIEW_LIMIT + 1);
    let length = 0;
    try {
        while (length < bytes.length) {
            const {done, value} = await reader.read();
            if (done) {
                break;
            }
            const part = value.subarray(0, bytes.length - length);
            bytes.set(part, length);
            length += part.length;
        }
    } finally {
        await reader.cancel();
    }
    const truncated = length > TEXT_PREVIEW_LIMIT;
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" :
        bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
    const text = new TextDecoder(encoding, {fatal: true}).decode(bytes.subarray(0, Math.min(length, TEXT_PREVIEW_LIMIT)),
        {stream: truncated});
    for (const character of text) {
        const code = character.charCodeAt(0);
        if (code < 32 && ![9, 10, 12, 13].includes(code)) {
            throw new Error("Asset is not a text file");
        }
    }
    return {text, truncated};
};

const renderDocument = (content: HTMLElement, text: string, extension: string, url: string, dataPath: string) => {
    if ([".md", ".markdown", ".html", ".htm"].includes(extension)) {
        const html = extension === ".md" || extension === ".markdown" ? Lute.New().MarkdownStr("", text) : text;
        // 仅保留静态排版，禁止文件内容借助样式、表单或设置事件委托影响宿主界面。
        content.innerHTML = window.DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ["p", "div", "span", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "a", "img",
                "strong", "b", "em", "i", "s", "del", "u", "sub", "sup", "mark", "kbd", "pre", "code", "blockquote",
                "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption"],
            ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "colspan", "rowspan", "start", "reversed"],
            ALLOW_DATA_ATTR: false,
            ALLOW_ARIA_ATTR: false,
        });
        content.querySelectorAll("pre > code").forEach((code: HTMLElement) => {
            code.parentElement.dataset.language = code.className.match(/(?:^|\s)language-([\w+-]+)/)?.[1] || "plaintext";
            code.replaceChildren(document.createTextNode(code.textContent));
        });
        content.querySelectorAll("[class]").forEach(item => item.removeAttribute("class"));
        content.querySelectorAll("pre > code").forEach(code => code.parentElement.classList.add("code-block"));
        content.querySelectorAll<HTMLImageElement>("img[src]").forEach(img => {
            const src = img.getAttribute("src");
            const resolved = new URL(src, url);
            if (dataPath && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(src) && resolved.pathname.startsWith("/assets/")) {
                const source = new URL(dataPath.split("/").map(encodeURIComponent).join("/"), new URL("/", url));
                resolved.searchParams.set("dataPath", decodeURIComponent(new URL(src, source).pathname.substring(1)));
            }
            img.src = resolved.href;
        });
    } else {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        pre.className = "code-block";
        pre.dataset.language = extension.substring(1) || "plaintext";
        code.textContent = text;
        pre.append(code);
        content.append(pre);
    }
    content.querySelectorAll<HTMLElement>(".code-block").forEach(block => {
        // 较长的代码仅显示原文，避免同步语法高亮阻塞设置面板。
        if (block.textContent.length > 16 * 1024) {
            block.dataset.language = "plaintext";
        }
    });
    highlightRender(content);
};

export class AssetPreview {
    private controller?: AbortController;
    private timer?: number;
    private pdf?: {destroy: () => Promise<void>};
    private resizeObserver?: ResizeObserver;

    constructor(private element: HTMLElement) {
    }

    public clear() {
        window.clearTimeout(this.timer);
        this.controller?.abort();
        this.controller = undefined;
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
        if (this.pdf) {
            void this.pdf.destroy().catch(console.error);
            this.pdf = undefined;
        }
        this.element.replaceChildren();
        this.element.removeAttribute("data-item");
    }

    public show(path: string, dataPath: string, delay = 0) {
        if (this.element.dataset.item === dataPath) {
            return;
        }
        this.clear();
        this.element.dataset.item = dataPath;
        const extension = getAssetExtension(path).toLowerCase();
        if ([...Constants.SIYUAN_ASSETS_IMAGE, ...Constants.SIYUAN_ASSETS_AUDIO, ...Constants.SIYUAN_ASSETS_VIDEO]
            .includes(extension)) {
            this.element.innerHTML = renderAssetsPreview(path, dataPath);
            return;
        }
        const controller = new AbortController();
        this.controller = controller;
        const active = () => !controller.signal.aborted && this.element.isConnected;
        const baseURL = document.getElementById("baseURL").getAttribute("href");
        const url = new URL(getAssetsPreviewPath(path, dataPath), new URL(baseURL + "/", location.href)).href;
        if (extension === ".pdf") {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "b3-button b3-button--outline";
            button.textContent = window.siyuan.languages.previewAsset;
            this.element.append(button);
            button.addEventListener("click", async (event) => {
                event.stopPropagation();
                button.disabled = true;
                button.textContent = window.siyuan.languages.loading;
                try {
                    const viewer = await loadPdfViewerModule();
                    if (!active()) {
                        return;
                    }
                    const content = document.createElement("div");
                    content.className = "config-assets__pdf" + (isMobile() ? " pdf-viewer--mobile" : "");
                    content.innerHTML = getPdfViewerHTML();
                    content.setAttribute("data-prevent-swipe", "true");
                    this.element.replaceChildren(content);
                    bindPdfTheme(content);
                    const pdf = viewer.webViewerLoad(url, content, undefined, undefined, true);
                    this.pdf = pdf;
                    this.resizeObserver = new ResizeObserver(() => {
                        if (active() && pdf.pdfDocument && content.clientWidth > 0) {
                            const scale = pdf.pdfViewer.currentScaleValue;
                            if (["auto", "page-fit", "page-width"].includes(scale)) {
                                pdf.pdfViewer.currentScaleValue = scale;
                            }
                            pdf.pdfViewer.update();
                        }
                    });
                    this.resizeObserver.observe(content);
                } catch (error) {
                    if (active()) {
                        this.element.textContent = window.siyuan.languages.assetPreviewFailed;
                    }
                    console.error(error);
                }
            });
            return;
        }
        this.element.textContent = window.siyuan.languages.loading;
        this.timer = window.setTimeout(async () => {
            try {
                const {text, truncated} = await readAssetPreviewText(url, controller.signal);
                if (!active()) {
                    return;
                }
                const content = document.createElement("div");
                content.className = "config-assets__document b3-typography";
                renderDocument(content, text, extension, url, dataPath);
                if (!text) {
                    content.textContent = window.siyuan.languages.emptyContent;
                }
                if (truncated) {
                    const tip = document.createElement("p");
                    tip.className = "ft__secondary";
                    tip.textContent = window.siyuan.languages.assetPreviewTruncated;
                    content.append(tip);
                }
                content.addEventListener("click", event => {
                    event.preventDefault();
                    event.stopPropagation();
                });
                this.element.replaceChildren(content);
            } catch (error) {
                if (active()) {
                    this.element.textContent = window.siyuan.languages.assetPreviewFailed;
                }
            }
        }, delay);
    }
}
