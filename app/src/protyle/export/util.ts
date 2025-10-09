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
import {highlightRender} from "../render/highlightRender";
import {processRender} from "../util/processCode";
import {isIPhone, isSafari, openByMobile, setStorageVal} from "../util/compatibility";
import {useShell} from "../../util/pathName";

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
        height: "70vh"
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
        previewElement.querySelectorAll(".protyle-linenumber__rows span").forEach((item, index) => {
            item.textContent = (index + 1).toString();
        });
        setTimeout(() => {
            addScript("/stage/protyle/js/html-to-image.min.js?v=1.11.13", "protyleHtml2image").then(async () => {
                let blob = await window.htmlToImage.toBlob(exportDialog.element.querySelector(".b3-dialog__content"));
                if (isIPhone() || isSafari()) {
                    await window.htmlToImage.toBlob(contentElement);
                    await window.htmlToImage.toBlob(contentElement);
                    await window.htmlToImage.toBlob(contentElement);
                    blob = await window.htmlToImage.toBlob(contentElement);
                }
                const formData = new FormData();
                formData.append("file", blob, btnsElement[1].getAttribute("data-title"));
                formData.append("type", "image/png");
                fetchPost("/api/export/exportAsFile", formData, (response) => {
                    openByMobile(response.data.file);
                });
                hideMessage(msgId);
                exportDialog.destroy();
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
                    addScript("/stage/protyle/js/html-to-image.min.js?v=1.11.13", "protyleHtml2image").then(() => {
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
