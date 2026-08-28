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
import {isInAndroid, isIPad, isIPhone, isSafari, saveExportFile, setStorageVal} from "../util/compatibility";
import {useShell} from "../../util/pathName";
import {copyPNGByLink, writePNGBlob} from "../../menus/util";

// WebKit/Chromium 会拒绝宽度或高度超过此限制的 canvas，导致生成空白图像。
// html-to-image 默认会进行限制，而 modern-screenshot 不会（maximumCanvasSize
// 默认为 0，即无限制），因此处理长文档时需要显式传入该参数。
const MAX_CANVAS_SIZE = 16384;

const IMAGE_PLACEHOLDER = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

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

export const exportImage = (id: string, copyOnly = false) => {
    const exportDialog = new Dialog({
        disableAnimation: true,
        title: copyOnly ? window.siyuan.languages.copyAsPNG : window.siyuan.languages.exportAsImage,
        content: `<div class="b3-dialog__content" style="${isMobile() ? "padding:8px;" : ""};background-color: var(--b3-theme-background)">
    <div style="${isMobile() ? "margin: 8px 0" : "padding: 48px;margin: 8px 0"}" class="export-img">
        <div ${isMobile() ? 'style="padding:8px"' : ""} class="protyle-wysiwyg${window.siyuan.config.editor.displayBookmarkIcon ? " protyle-wysiwyg--attr" : ""}"></div>
        <div class="export-img__watermark"></div>
    </div>
</div>
<div class="b3-dialog__action${copyOnly ? " fn__none" : ""}" style="justify-content: flex-start">
    <label class="fn__flex fn__flex-center">
        ${window.siyuan.languages.export17}
        <span class="fn__space"></span>
        <input id="addTitle" class="b3-switch fn__flex-center" type="checkbox" ${window.siyuan.config.export.addTitle ? "checked" : ""}>
    </label>
    <span class="fn__space"></span>
    <input aria-label="${window.siyuan.languages.title}" id="customTitle" class="b3-text-field fn__flex-1 fn__flex-center" placeholder="${window.siyuan.languages.title}" ${window.siyuan.config.export.addTitle ? "" : "disabled"}>
</div>
<div class="b3-dialog__action">
    <label class="fn__flex${copyOnly ? " fn__none" : ""}">
        ${window.siyuan.languages.exportPDF5}
        <span class="fn__space"></span>
        <input id="keepFold" class="b3-switch fn__flex-center" type="checkbox" ${!copyOnly && window.siyuan.storage[Constants.LOCAL_EXPORTIMG].keepFold ? "checked" : ""}>
    </label>
    <label class="fn__flex${copyOnly ? " fn__none" : ""}" style="margin-left: 24px">
        ${window.siyuan.languages.export30}
        <span class="fn__space"></span>
        <input id="watermark" class="b3-switch fn__flex-center" type="checkbox" ${window.siyuan.storage[Constants.LOCAL_EXPORTIMG].watermark ? "checked" : ""}>
    </label>
    <span class="fn__flex-1 export-img__space"></span>
    <button data-type="cancel" disabled class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button data-type="copy" disabled class="b3-button b3-button--text${copyOnly ? " fn__none" : ""}">${window.siyuan.languages.copyAsPNG}</button><div class="fn__space${copyOnly ? " fn__none" : ""}"></div>
    <button data-type="export" disabled class="b3-button b3-button--text${copyOnly ? " fn__none" : ""}">${window.siyuan.languages.exportFile}</button>
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
    const cancelButton = exportDialog.element.querySelector('[data-type="cancel"]') as HTMLButtonElement;
    const copyButton = exportDialog.element.querySelector('[data-type="copy"]') as HTMLButtonElement;
    const exportButton = exportDialog.element.querySelector('[data-type="export"]') as HTMLButtonElement;
    const previewElement = exportDialog.element.querySelector(".protyle-wysiwyg") as HTMLElement;
    const foldElement = exportDialog.element.querySelector("#keepFold") as HTMLInputElement;
    const watermarkElement = exportDialog.element.querySelector("#watermark") as HTMLInputElement;
    const addTitleElement = exportDialog.element.querySelector("#addTitle") as HTMLInputElement;
    const customTitleElement = exportDialog.element.querySelector("#customTitle") as HTMLInputElement;
    let imageName = "image.png";
    let outputting = false;
    let titleRefreshTimer: number;
    let titleComposing = false;

    const setActionDisabled = (disabled: boolean) => {
        cancelButton.disabled = disabled;
        copyButton.disabled = disabled;
        exportButton.disabled = disabled;
    };
    const uploadImageBlob = (blob: Blob) => {
        const formData = new FormData();
        formData.append("file", blob, imageName);
        formData.append("type", "image/png");
        return new Promise<IWebSocketData>((resolve) => {
            fetchPost("/api/export/exportAsFile", formData, (response) => {
                resolve(response);
            });
        });
    };
    const renderImageBlob = async () => {
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
        await new Promise((resolve) => {
            setTimeout(resolve, Constants.TIMEOUT_LOAD);
        });
        if (isIPhone() || isIPad() || isSafari()) {
            // modern-screenshot 通过缓存默认样式提高 WebKit/WKWebView 环境下的导出性能。
            await addScript(`${Constants.PROTYLE_CDN}/js/modern-screenshot.min.js?v=4.6.6`, "protyleModernScreenshot");
            return window.modernScreenshot.domToBlob(
                exportDialog.element.querySelector(".b3-dialog__content") as HTMLElement, {
                    type: "image/png",
                    // 默认为 1，会导致高清屏上导出的图片比 html-to-image 模糊
                    scale: window.devicePixelRatio || 1,
                    maximumCanvasSize: MAX_CANVAS_SIZE,
                    fetch: {placeholderImage: IMAGE_PLACEHOLDER}
                });
        }
        await addScript(`${Constants.PROTYLE_CDN}/js/html-to-image.min.js?v=1.11.13`, "protyleHtml2image");
        return window.htmlToImage.toBlob(
            exportDialog.element.querySelector(".b3-dialog__content") as HTMLElement, {
                imagePlaceholder: IMAGE_PLACEHOLDER,
                onImageErrorHandler: (event: Event) => {
                    (event.target as HTMLImageElement).src = IMAGE_PLACEHOLDER;
                }
            });
    };
    const outputImage = async (type: "copy" | "export") => {
        if (outputting) {
            return;
        }
        outputting = true;
        setActionDisabled(true);
        const msgId = showMessage(window.siyuan.languages.exporting, 0);
        const containerElement = exportDialog.element.querySelector(".b3-dialog__container") as HTMLElement;
        const oldHeight = containerElement.style.height;
        containerElement.style.height = "";
        /// #if MOBILE
        containerElement.style.width = "100vw";
        /// #endif
        const contentElement = exportDialog.element.querySelector(".b3-dialog__content") as HTMLElement;
        const oldOverflow = contentElement.style.overflow;
        contentElement.style.overflow = "hidden";
        if (!copyOnly) {
            setStorageVal(Constants.LOCAL_EXPORTIMG, window.siyuan.storage[Constants.LOCAL_EXPORTIMG]);
        }
        try {
            const blob = await renderImageBlob();
            if (!blob) {
                throw new Error(window.siyuan.languages.exportFileSaveFailed);
            }
            if (type === "copy") {
                let copied: boolean;
                if (isInAndroid()) {
                    const response = await uploadImageBlob(blob);
                    copied = response.code === 0;
                    if (copied) {
                        copyPNGByLink(response.data.file);
                    }
                } else {
                    copied = await writePNGBlob(blob);
                }
                hideMessage(msgId);
                if (!copied) {
                    return;
                }
                showMessage(window.siyuan.languages.copied);
            } else {
                const response = await uploadImageBlob(blob);
                if (response.code !== 0) {
                    throw new Error(response.msg);
                }
                await saveExportFile(response.data.file, msgId);
            }
            exportDialog.destroy();
        } catch (e) {
            hideMessage(msgId);
            console.error("Export image error:", e);
            showMessage(e instanceof Error ? e.message : window.siyuan.languages.exportFileSaveFailed, 7000, "error");
        } finally {
            outputting = false;
            if (document.body.contains(exportDialog.element)) {
                containerElement.style.height = oldHeight;
                contentElement.style.overflow = oldOverflow;
                setActionDisabled(false);
            }
        }
    };

    cancelButton.addEventListener("click", () => {
        exportDialog.destroy();
    });
    copyButton.addEventListener("click", () => {
        outputImage("copy");
    });
    exportButton.addEventListener("click", () => {
        outputImage("export");
    });
    const refreshExportPreview = () => {
        setActionDisabled(true);
        if (!exportDialog.element.querySelector(".fn__loading")) {
            exportButton.parentElement.insertAdjacentHTML("afterend", '<div class="fn__loading"><img height="128px" width="128px" src="stage/loading-pure.svg"></div>');
        }
        fetchPost("/api/export/exportPreviewHTML", {
            id,
            keepFold: foldElement.checked,
            image: true,
            addTitle: addTitleElement.checked,
            customTitle: customTitleElement.value,
        }, (response) => {
            refreshPreview(response);
        });
    };
    addTitleElement.addEventListener("change", () => {
        customTitleElement.disabled = !addTitleElement.checked;
        refreshExportPreview();
    });
    const scheduleTitleRefresh = () => {
        window.clearTimeout(titleRefreshTimer);
        titleRefreshTimer = window.setTimeout(refreshExportPreview, 300);
    };
    customTitleElement.addEventListener("compositionstart", () => {
        titleComposing = true;
        window.clearTimeout(titleRefreshTimer);
    });
    customTitleElement.addEventListener("compositionend", () => {
        titleComposing = false;
        scheduleTitleRefresh();
    });
    customTitleElement.addEventListener("input", () => {
        if (!titleComposing) {
            scheduleTitleRefresh();
        }
    });
    foldElement.addEventListener("change", () => {
        window.siyuan.storage[Constants.LOCAL_EXPORTIMG].keepFold = foldElement.checked;
        refreshExportPreview();
    });
    watermarkElement.addEventListener("change", () => {
        window.siyuan.storage[Constants.LOCAL_EXPORTIMG].watermark = watermarkElement.checked;
        updateWatermark();
    });
    const updateWatermark = async () => {
        const watermarkPreviewElement = exportDialog.element.querySelector(".export-img__watermark") as HTMLElement;
        watermarkPreviewElement.innerHTML = "";
        if (watermarkElement.checked) {
            if (window.siyuan.config.export.imageWatermarkDesc) {
                watermarkPreviewElement.innerHTML = window.siyuan.config.export.imageWatermarkDesc;
            } else if (window.siyuan.config.export.imageWatermarkStr) {
                if (window.siyuan.config.export.imageWatermarkStr.startsWith("http")) {
                    watermarkPreviewElement.setAttribute("style", `background-image: url(${window.siyuan.config.export.imageWatermarkStr});background-repeat: repeat;position: absolute;top: 0;left: 0;width: 100%;height: 100%;border-radius: var(--b3-border-radius-b);`);
                } else {
                    await addScript(`${Constants.PROTYLE_CDN}/js/html-to-image.min.js?v=1.11.13`, "protyleHtml2image");
                    const width = Math.max(exportDialog.element.querySelector(".export-img").clientWidth / 3, 150);
                    watermarkPreviewElement.setAttribute("style", `width: ${width}px;height: ${width}px;display: flex;justify-content: center;align-items: center;color: var(--b3-border-color);font-size: 14px;`);
                    watermarkPreviewElement.innerHTML = `<div style="transform: rotate(-45deg)">${window.siyuan.config.export.imageWatermarkStr}</div>`;
                    const canvas = await window.htmlToImage.toCanvas(watermarkPreviewElement);
                    watermarkPreviewElement.innerHTML = "";
                    watermarkPreviewElement.setAttribute("style", `background-image: url(${canvas.toDataURL("image/png")});background-repeat: repeat;position: absolute;top: 0;left: 0;width: 100%;height: 100%;border-radius: var(--b3-border-radius-b);`);
                }
            }
        } else {
            watermarkPreviewElement.removeAttribute("style");
        }
    };
    const refreshPreview = async (response: IWebSocketData) => {
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

        await updateWatermark();
        exportDialog.element.querySelector(".fn__loading")?.remove();
        if (copyOnly) {
            await outputImage("copy");
        } else {
            setActionDisabled(false);
        }
    };
    fetchPost("/api/export/exportPreviewHTML", {
        id,
        keepFold: foldElement.checked,
        image: true,
        addTitle: addTitleElement.checked,
        customTitle: customTitleElement.value,
    }, (response) => {
        imageName = response.data.name + ".png";
        refreshPreview(response);
    });
};
