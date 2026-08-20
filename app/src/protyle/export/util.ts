/// #if !BROWSER
import {escapeHtml} from "../../util/escape";
import * as path from "path";
/// #endif
import {hideMessage, showMessage} from "../../dialog/message";
import {fetchPost} from "../../util/fetch";
import {Dialog} from "../../dialog";
import {addScript} from "../util/addScript";
import {isMobile} from "../../util/functions";
import {Constants} from "../../constants";
import {highlightRender, lineNumberRender} from "../render/highlightRender";
import {processRender} from "../util/processCode";
import {isIPad, isIPhone, isSafari, saveExportFile, setStorageVal} from "../util/compatibility";
import {useShell} from "../../util/pathName";

// WebKit/Chromium reject canvases whose width or height exceeds this, producing a blank
// image. html-to-image clamps to it by default, modern-screenshot does not (maximumCanvasSize
// defaults to 0 = unlimited), so long documents need it passed explicitly.
const MAX_CANVAS_SIZE = 16384;

const IMAGE_PLACEHOLDER = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// ⚠️ TEMPORARY BENCHMARK — remove before merging. ⚠️
// Rasterizes the document with *both* libraries on every platform and logs the timings to the
// devtools console, so the html-to-image / modern-screenshot comparison can be made on a real
// device instead of from estimates. Set to false to restore normal single-library behaviour.
const BENCHMARK_EXPORT_IMAGE = true;
// The library that runs second benefits from fonts/images the first one already warmed, so flip
// this and re-run the same document to see how much of the gap is just ordering.
const BENCHMARK_MODERN_FIRST = true;

const benchLog = (...args: unknown[]) => {
    console.log("%c[export-image bench]", "color:#3182f6;font-weight:bold", ...args);
};

const benchDescribeBlob = async (blob: Blob) => {
    const size = `${(blob.size / 1024 / 1024).toFixed(2)}MB`;
    try {
        // 实际像素尺寸，用来验证 scale 与 maximumCanvasSize 是否生效
        const bitmap = await createImageBitmap(blob);
        const dimensions = `${bitmap.width}x${bitmap.height}`;
        bitmap.close();
        return `${dimensions} ${size}`;
    } catch (e) {
        return `<undecodable: ${e}> ${size}`;
    }
};

// 复刻上游在 WebKit 上的真实路径：对同一个 .b3-dialog__content 连跑 5 次
const benchHtmlToImage = async (contentElement: HTMLElement) => {
    const options = {
        imagePlaceholder: IMAGE_PLACEHOLDER,
        onImageErrorHandler: (event: Event) => {
            (event.target as HTMLImageElement).src = IMAGE_PLACEHOLDER;
        }
    };
    const start = performance.now();
    let blob = await window.htmlToImage.toBlob(contentElement, options);
    benchLog(`html-to-image      pass 1 (warmup)  ${(performance.now() - start).toFixed(0)}ms`);
    for (let i = 0; i < 4; i++) {
        const passStart = performance.now();
        blob = await window.htmlToImage.toBlob(contentElement, options);
        benchLog(`html-to-image      pass ${i + 2}           ${(performance.now() - passStart).toFixed(0)}ms`);
    }
    const total = performance.now() - start;
    benchLog(`html-to-image      TOTAL 5 passes   ${total.toFixed(0)}ms   ${await benchDescribeBlob(blob)}`);
    return {blob, total};
};

const benchModernScreenshot = async (contentElement: HTMLElement) => {
    const start = performance.now();
    const blob = await window.modernScreenshot.domToBlob(contentElement, {
        type: "image/png",
        scale: window.devicePixelRatio || 1,
        maximumCanvasSize: MAX_CANVAS_SIZE,
        fetch: {placeholderImage: IMAGE_PLACEHOLDER}
    });
    const total = performance.now() - start;
    benchLog(`modern-screenshot  TOTAL 1 pass     ${total.toFixed(0)}ms   ${await benchDescribeBlob(blob)}`);
    return {blob, total};
};

const benchmarkRasterizers = async (contentElement: HTMLElement) => {
    // 两个库都先加载完再计时，避免把网络请求算进第一个跑的库
    await Promise.all([
        addScript(`${Constants.PROTYLE_CDN}/js/modern-screenshot.min.js?v=4.6.6`, "protyleModernScreenshot"),
        addScript(`${Constants.PROTYLE_CDN}/js/html-to-image.min.js?v=1.11.13`, "protyleHtml2image"),
    ]);
    const scale = window.devicePixelRatio || 1;
    const isWebKitPath = isIPhone() || isIPad() || isSafari();
    benchLog("env", {
        devicePixelRatio: scale,
        webKitPath: isWebKitPath,
        modernFirst: BENCHMARK_MODERN_FIRST,
        cssSize: `${contentElement.scrollWidth}x${contentElement.scrollHeight}`,
        unclampedCanvas: `${Math.floor(contentElement.scrollWidth * scale)}x${Math.floor(contentElement.scrollHeight * scale)}`,
        maxCanvasSize: MAX_CANVAS_SIZE,
        userAgent: navigator.userAgent,
    });

    let modern;
    let legacy;
    if (BENCHMARK_MODERN_FIRST) {
        modern = await benchModernScreenshot(contentElement);
        legacy = await benchHtmlToImage(contentElement);
    } else {
        legacy = await benchHtmlToImage(contentElement);
        modern = await benchModernScreenshot(contentElement);
    }
    benchLog(`==> modern-screenshot is ${(legacy.total / modern.total).toFixed(2)}x the speed of the 5-pass html-to-image path (${(legacy.total - modern.total).toFixed(0)}ms saved)`);
    // 导出的仍然是当前逻辑会选用的那个库的结果，保证基准测试期间文件依然正确
    return isWebKitPath ? modern.blob : legacy.blob;
};
// ⚠️ END TEMPORARY BENCHMARK ⚠️

export const afterExport = (exportPath: string, msgId: string) => {
    /// #if !BROWSER
    showMessage(`${window.siyuan.languages.exported} ${escapeHtml(exportPath)}
<div class="fn__space"></div>
<button class="b3-button b3-button--white">${window.siyuan.languages.showInFolder}</button>`, 6000, "info", msgId);
    document.querySelector(`#message [data-id="${msgId}"] button`).addEventListener("click", () => {
        useShell("showItemInFolder", path.join(exportPath));
        hideMessage(msgId);
    });
    /// #endif
};

export const exportImage = (id: string) => {
    const exportDialog = new Dialog({
        disableAnimation: true,
        title: window.siyuan.languages.exportAsImage,
        content: `<div class="b3-dialog__content" style="${isMobile() ? "padding:8px;" : ""};background-color: var(--b3-theme-background)">
    <div style="${isMobile() ? "margin: 8px 0" : "padding: 48px;margin: 8px 0"}" class="export-img">
        <div ${isMobile() ? 'style="padding:8px"' : ""} class="protyle-wysiwyg${window.siyuan.config.editor.displayBookmarkIcon ? " protyle-wysiwyg--attr" : ""}"></div>
        <div class="export-img__watermark"></div>
    </div>
</div>
<div class="b3-dialog__action">
    <label class="fn__flex">
        ${window.siyuan.languages.exportPDF5}
        <span class="fn__space"></span>
        <input id="keepFold" class="b3-switch fn__flex-center" type="checkbox" ${window.siyuan.storage[Constants.LOCAL_EXPORTIMG].keepFold ? "checked" : ""}>
    </label>
    <label class="fn__flex" style="margin-left: 24px">
        ${window.siyuan.languages.export30}
        <span class="fn__space"></span>
        <input id="watermark" class="b3-switch fn__flex-center" type="checkbox" ${window.siyuan.storage[Constants.LOCAL_EXPORTIMG].watermark ? "checked" : ""}>
    </label>
    <span class="fn__flex-1 export-img__space"></span>
    <button disabled class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button disabled class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>
 <div class="fn__loading"><img height="128px" width="128px" src="stage/loading-pure.svg"></div>`,
        width: isMobile() ? "92vw" : "990px",
        height: "70vh",
        resizeCallback() {
            previewElement.querySelectorAll(".code-block .protyle-linenumber__rows").forEach((item: HTMLElement) => {
                if ((item.nextElementSibling as HTMLElement).style.wordBreak === "break-word") {
                    lineNumberRender(item.parentElement);
                }
            });
        }
    });
    exportDialog.element.setAttribute("data-key", Constants.DIALOG_EXPORTIMAGE);
    const btnsElement = exportDialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        exportDialog.destroy();
    });
    btnsElement[1].addEventListener("click", async () => {
        const msgId = showMessage(window.siyuan.languages.exporting, 0);
        const containerElement = exportDialog.element.querySelector(".b3-dialog__container") as HTMLElement;
        containerElement.style.height = "";
        /// #if MOBILE
        containerElement.style.width = "100vw";
        /// #endif
        const contentElement = exportDialog.element.querySelector(".b3-dialog__content") as HTMLElement;
        contentElement.style.overflow = "hidden";
        setStorageVal(Constants.LOCAL_EXPORTIMG, window.siyuan.storage[Constants.LOCAL_EXPORTIMG]);
        const plantumlElements = previewElement.querySelectorAll("[data-subtype='plantuml']");
        for (let i = 0; i < plantumlElements.length; i++) {
            const objectElement = plantumlElements[i].querySelector("object");
            if (objectElement) {
                const res = await fetch(objectElement.getAttribute("data"));
                const response = await res.text();
                objectElement.insertAdjacentHTML("beforebegin", response as string);
                objectElement.remove();
            }
        }
        previewElement.querySelectorAll(".protyle-linenumber__rows").forEach((rowsElement) => {
            // 每个代码块的行号都需要从 1 开始计数，不能跨代码块累加
            rowsElement.querySelectorAll("span").forEach((item, index) => {
                item.textContent = (index + 1).toString();
            });
        });
        const exportBlob = (blob: Blob) => {
            const formData = new FormData();
            formData.append("file", blob, btnsElement[1].getAttribute("data-title"));
            formData.append("type", "image/png");
            fetchPost("/api/export/exportAsFile", formData, (response) => {
                saveExportFile(response.data.file, msgId);
            });
            exportDialog.destroy();
        };
        setTimeout(() => {
            if (BENCHMARK_EXPORT_IMAGE) {
                benchmarkRasterizers(contentElement).then(exportBlob);
                return;
            }
            if (isIPhone() || isIPad() || isSafari()) {
                // html-to-image clones every node and copies its full computed style one property at
                // a time, which is O(nodes) with a huge constant on WebKit/WKWebView (~45s for a
                // mid-size doc), and it needs to be run 4 times there before the fonts/images settle.
                // modern-screenshot caches default styles per tag, only writes the differing
                // properties and renders correctly in a single pass (~8s for the same doc).
                addScript(`${Constants.PROTYLE_CDN}/js/modern-screenshot.min.js?v=4.6.6`, "protyleModernScreenshot").then(async () => {
                    exportBlob(await window.modernScreenshot.domToBlob(contentElement, {
                        type: "image/png",
                        // 默认为 1，会导致高清屏上导出的图片比 html-to-image 模糊
                        scale: window.devicePixelRatio || 1,
                        maximumCanvasSize: MAX_CANVAS_SIZE,
                        fetch: {placeholderImage: IMAGE_PLACEHOLDER}
                    }));
                });
                return;
            }
            addScript(`${Constants.PROTYLE_CDN}/js/html-to-image.min.js?v=1.11.13`, "protyleHtml2image").then(async () => {
                exportBlob(await window.htmlToImage.toBlob(contentElement, {
                    imagePlaceholder: IMAGE_PLACEHOLDER,
                    onImageErrorHandler: (event: Event) => {
                        (event.target as HTMLImageElement).src = IMAGE_PLACEHOLDER;
                    }
                }));
            });
        }, Constants.TIMEOUT_LOAD);
    });
    const previewElement = exportDialog.element.querySelector(".protyle-wysiwyg") as HTMLElement;
    const foldElement = (exportDialog.element.querySelector("#keepFold") as HTMLInputElement);
    foldElement.addEventListener("change", () => {
        btnsElement[0].setAttribute("disabled", "disabled");
        btnsElement[1].setAttribute("disabled", "disabled");
        btnsElement[1].parentElement.insertAdjacentHTML("afterend", '<div class="fn__loading"><img height="128px" width="128px" src="stage/loading-pure.svg"></div>');
        window.siyuan.storage[Constants.LOCAL_EXPORTIMG].keepFold = foldElement.checked;
        fetchPost("/api/export/exportPreviewHTML", {
            id,
            keepFold: foldElement.checked,
            image: true,
        }, (response) => {
            refreshPreview(response);
        });
    });
    const watermarkElement = (exportDialog.element.querySelector("#watermark") as HTMLInputElement);
    watermarkElement.addEventListener("change", () => {
        window.siyuan.storage[Constants.LOCAL_EXPORTIMG].watermark = watermarkElement.checked;
        updateWatermark();
    });
    const updateWatermark = () => {
        const watermarkPreviewElement = exportDialog.element.querySelector(".export-img__watermark") as HTMLElement;
        watermarkPreviewElement.innerHTML = "";
        if (watermarkElement.checked) {
            if (window.siyuan.config.export.imageWatermarkDesc) {
                watermarkPreviewElement.innerHTML = window.siyuan.config.export.imageWatermarkDesc;
            } else if (window.siyuan.config.export.imageWatermarkStr) {
                if (window.siyuan.config.export.imageWatermarkStr.startsWith("http")) {
                    watermarkPreviewElement.setAttribute("style", `background-image: url(${window.siyuan.config.export.imageWatermarkStr});background-repeat: repeat;position: absolute;top: 0;left: 0;width: 100%;height: 100%;border-radius: var(--b3-border-radius-b);`);
                } else {
                    addScript(`${Constants.PROTYLE_CDN}/js/html-to-image.min.js?v=1.11.13`, "protyleHtml2image").then(() => {
                        const width = Math.max(exportDialog.element.querySelector(".export-img").clientWidth / 3, 150);
                        watermarkPreviewElement.setAttribute("style", `width: ${width}px;height: ${width}px;display: flex;justify-content: center;align-items: center;color: var(--b3-border-color);font-size: 14px;`);
                        watermarkPreviewElement.innerHTML = `<div style="transform: rotate(-45deg)">${window.siyuan.config.export.imageWatermarkStr}</div>`;
                        window.htmlToImage.toCanvas(watermarkPreviewElement).then((canvas) => {
                            watermarkPreviewElement.innerHTML = "";
                            watermarkPreviewElement.setAttribute("style", `background-image: url(${canvas.toDataURL("image/png")});background-repeat: repeat;position: absolute;top: 0;left: 0;width: 100%;height: 100%;border-radius: var(--b3-border-radius-b);`);
                        });
                    });
                }
            }
        } else {
            watermarkPreviewElement.removeAttribute("style");
        }
    };
    const refreshPreview = (response: IWebSocketData) => {
        previewElement.innerHTML = response.data.content;
        previewElement.setAttribute("data-doc-type", response.data.type || "NodeDocument");
        Object.keys(response.data.attrs).forEach(key => {
            previewElement.setAttribute(key, response.data.attrs[key]);
        });
        previewElement.querySelectorAll(".code-block").forEach(item => {
            item.setAttribute("linewrap", "true");
        });
        processRender(previewElement);
        highlightRender(previewElement);
        previewElement.querySelectorAll("table").forEach((item: HTMLElement) => {
            if (item.clientWidth > item.parentElement.clientWidth) {
                item.setAttribute("style", `margin-bottom:${item.parentElement.clientWidth * item.clientHeight / item.clientWidth - item.parentElement.clientHeight + 1}px;transform: scale(${item.parentElement.clientWidth / item.clientWidth});transform-origin: top left;`);
                item.parentElement.style.overflow = "hidden";
            }
        });

        updateWatermark();
        btnsElement[0].removeAttribute("disabled");
        btnsElement[1].removeAttribute("disabled");
        exportDialog.element.querySelector(".fn__loading").remove();
    };
    fetchPost("/api/export/exportPreviewHTML", {
        id,
        keepFold: foldElement.checked,
        image: true,
    }, (response) => {
        refreshPreview(response);
        btnsElement[1].setAttribute("data-title", response.data.name + ".png");
    });
};
