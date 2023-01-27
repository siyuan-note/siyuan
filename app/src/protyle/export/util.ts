/// #if !BROWSER
import {escapeHtml} from "../../util/escape";
import {shell} from "electron";
import * as path from "path";
/// #endif
import {hideMessage, showMessage} from "../../dialog/message";
import {fetchPost} from "../../util/fetch";
import {Dialog} from "../../dialog";
import {addScript} from "../util/addScript";
import {isMobile} from "../../util/functions";
import {Constants} from "../../constants";
import {highlightRender} from "../markdown/highlightRender";
import {processRender} from "../util/processCode";
import {openByMobile, setStorageVal} from "../util/compatibility";

export const afterExport = (exportPath: string, msgId: string) => {
    /// #if !BROWSER
    showMessage(`${window.siyuan.languages.exported} ${escapeHtml(exportPath)}
<div class="fn__space"></div>
<button class="b3-button b3-button--white">${window.siyuan.languages.showInFolder}</button>`, 6000, "info", msgId);
    document.querySelector(`#message [data-id="${msgId}"] button`).addEventListener("click", () => {
        shell.showItemInFolder(path.join(exportPath));
        hideMessage(msgId);
    });
    /// #endif
};

export const exportImage = (id: string) => {
    const exportDialog = new Dialog({
        title: `<div class="fn__flex">
    ${window.siyuan.languages.exportAsImage}
    <div class="fn__flex-1"></div>
    <label class="fn__flex">
        ${window.siyuan.languages.exportPDF5}
        <span class="fn__space"></span>
        <input id="keepFold" class="b3-switch fn__flex-center" type="checkbox" ${window.siyuan.storage[Constants.LOCAL_EXPORTIMG].keepFold ? "checked" : ""}>
    </label>
</div>
`,
        content: `<div class="b3-dialog__content" style="max-height: 70vh;overflow: auto;${isMobile() ? "padding:8px;" : ""};background-color: var(--b3-theme-background)">
    <div style="${isMobile() ? "padding: 16px;margin: 16px 0" : "padding: 48px;margin: 8px 0 24px"};border: 1px solid var(--b3-border-color);border-radius: 10px;" class="b3-dialog__exportimg protyle-wysiwyg${window.siyuan.config.editor.displayBookmarkIcon ? " protyle-wysiwyg--attr" : ""}" id="preview"></div>
    <div class="ft__smaller ft__on-surface fn__flex"><img style="height: 18px;margin: 0 8px" src="stage/icon.png">${window.siyuan.languages.exportBySiYuan}</div>
    <div class="fn__hr--b"></div>
    <div class="fn__hr--b"></div>
</div>
<div class="b3-dialog__action">
    <button disabled class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button disabled class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>
 <div class="fn__loading"><img height="128px" width="128px" src="stage/loading-pure.svg"></div>`,
        width: isMobile() ? "90vw" : "990px",
    });
    const btnsElement = exportDialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        exportDialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        const msgId = showMessage(window.siyuan.languages.exporting, 0);
        previewElement.parentElement.style.maxHeight = "none";
        setStorageVal(Constants.LOCAL_EXPORTIMG, window.siyuan.storage[Constants.LOCAL_EXPORTIMG]);
        setTimeout(() => {
            addScript("stage/protyle/js/html2canvas.min.js?v=1.4.1", "protyleHtml2canvas").then(() => {
                window.html2canvas(previewElement.parentElement).then((canvas) => {
                    canvas.toBlob((blob: Blob) => {
                        const formData = new FormData();
                        formData.append("file", blob, btnsElement[1].getAttribute("data-title"));
                        formData.append("type", "image/png");
                        fetchPost("/api/export/exportAsFile", formData, (response) => {
                            openByMobile(response.data.file);
                        });
                        hideMessage(msgId);
                        exportDialog.destroy();
                    });
                });
            });
        }, Constants.TIMEOUT_TRANSITION);
    });
    const previewElement = exportDialog.element.querySelector("#preview") as HTMLElement;
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
    const refreshPreview = (response: IWebSocketData) => {
        previewElement.innerHTML = response.data.content;
        processRender(previewElement);
        highlightRender(previewElement);
        previewElement.querySelectorAll("table").forEach((item: HTMLElement) => {
            if (item.clientWidth > item.parentElement.clientWidth) {
                // @ts-ignore
                item.style.zoom = item.parentElement.clientWidth / item.clientWidth;
            }
        });
        previewElement.querySelectorAll(".li > .protyle-action > svg").forEach(item => {
            const id = item.firstElementChild.getAttribute("xlink:href");
            const symbolElements = document.querySelectorAll(id);
            let viewBox = "0 0 32 32";
            if (id === "#iconDot") {
                viewBox = "0 0 20 20";
            }
            item.setAttribute("viewBox", viewBox);
            item.innerHTML = symbolElements[symbolElements.length - 1].innerHTML;
        });
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
