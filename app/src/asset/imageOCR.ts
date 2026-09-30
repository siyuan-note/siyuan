import {Dialog} from "../dialog";
import {showMessage} from "../dialog/message";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {writeText} from "../protyle/util/compatibility";
import {invalidateImageOCRStatus} from "./imageOCRStatus";

export const copyImageOCRText = (path: string) => {
    fetchPost("/api/asset/getImageOCRText", {path}, (response) => {
        writeText(response.data.text);
        showMessage(window.siyuan.languages.copied);
    });
};

export const openImageOCR = (path: string) => {
    let closed = false;
    let originalText = "";
    const controller = new AbortController();
    const dialog = new Dialog({
        title: window.siyuan.languages.ocrResult,
        transparent: true,
        disableClose: true,
        width: "min(900px, 88vw)",
        height: "min(620px, 80vh)",
        content: `<div class="b3-dialog__content image-ocr">
    <div class="image-ocr__preview"><img></div>
    <textarea class="b3-text-field image-ocr__text" spellcheck="false" disabled></textarea>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--text" data-action="copy" disabled>${window.siyuan.languages.copy}</button>
    <div class="fn__flex-1"></div>
    <button class="b3-button b3-button--cancel" data-action="cancel">${window.siyuan.languages.cancel}</button>
    <span class="fn__space"></span>
    <button class="b3-button b3-button--text" data-action="save" disabled>${window.siyuan.languages.save}</button>
</div>`,
        destroyCallback: () => {
            closed = true;
            controller.abort();
        }
    });
    const textarea = dialog.element.querySelector("textarea");
    const copy = dialog.element.querySelector<HTMLButtonElement>('[data-action="copy"]');
    const save = dialog.element.querySelector<HTMLButtonElement>('[data-action="save"]');
    const close = () => {
        closed = true;
        controller.abort();
        dialog.destroy();
    };
    dialog.element.querySelector("img").src = path;
    textarea.placeholder = window.siyuan.languages.loading;
    textarea.setAttribute("aria-label", window.siyuan.languages.ocrResult);
    copy.addEventListener("click", () => {
        writeText(textarea.value);
        showMessage(window.siyuan.languages.copied);
    });
    dialog.element.querySelector('[data-action="cancel"]').addEventListener("click", close);
    save.addEventListener("click", async () => {
        if (textarea.value === originalText) {
            close();
            return;
        }
        save.disabled = true;
        try {
            const response = await fetchSyncPost("/api/asset/setImageOCRText", {path, text: textarea.value});
            if (response.code === 0) {
                invalidateImageOCRStatus(path);
            }
            if (!closed && response.code === 0) {
                close();
            }
        } finally {
            save.disabled = false;
        }
    });
    dialog.element.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Escape" && !event.isComposing) {
            close();
            event.preventDefault();
            event.stopPropagation();
        }
    });
    fetchPost("/api/asset/getImageOCRText", {path}, (response) => {
        if (closed) {
            return;
        }
        originalText = response.data.text;
        textarea.value = originalText;
        textarea.placeholder = window.siyuan.languages.ocrResult;
        textarea.disabled = false;
        copy.disabled = false;
        save.disabled = false;
        textarea.focus();
    }, undefined, undefined, controller.signal);
};
