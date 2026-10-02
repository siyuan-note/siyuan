import type {OCRThresholds} from "../types/api";
import {Dialog} from "../dialog";
import {isMobile} from "../util/functions";
import {escapeAttr} from "../util/escape";

export const openOCRThresholds = (
    initial: OCRThresholds | undefined | null,
    save: (value: OCRThresholds) => Promise<boolean>,
    onClose: () => void,
): Dialog => {
    const languages = window.siyuan.languages;
    const fields = [
        {key: "detection", title: languages.ocrDetectionThreshold},
        {key: "box", title: languages.ocrBoxThreshold},
        {key: "recognition", title: languages.ocrRecognitionThreshold},
    ] as const;
    let closed = false;
    let saving = false;
    const dialog = new Dialog({
        title: `PaddleOCR - ${languages.configGroupAdvanced}`,
        width: isMobile() ? "92vw" : "520px",
        content: `<div class="b3-dialog__content">
<div class="b3-label__text">${languages.ocrThresholdsTip}</div><div class="fn__hr--b"></div>
${fields.map(({key, title}) => `<div class="b3-label b3-label--inner">
<label class="config-name fn__block" for="ocr-${key}">${title}</label><div class="fn__hr"></div>
<input id="ocr-${key}" class="b3-text-field fn__block" type="number" min="0" max="1" step="any" value="${initial?.[key] ?? ""}" placeholder="${escapeAttr(languages.default)}"></div>`).join("")}
</div><div class="b3-dialog__action">
<button class="b3-button b3-button--outline" data-action="reset">${languages.reset}</button><div class="fn__flex-1"></div>
<button class="b3-button b3-button--cancel" data-action="cancel">${languages.cancel}</button><div class="fn__space"></div>
<button class="b3-button b3-button--text" data-action="save">${languages.confirm}</button></div>`,
        destroyCallback: () => { closed = true; onClose(); },
    });
    dialog.element.addEventListener("input", event => {
        const input = event.target as HTMLInputElement;
        if (input.tagName === "INPUT") input.setCustomValidity("");
    });
    dialog.element.addEventListener("click", async event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
        if (!button || saving || closed) return;
        if (button.dataset.action === "cancel") {
            dialog.destroy();
            return;
        }
        if (button.dataset.action === "reset") {
            fields.forEach(({key}) => {
                const input = dialog.element.querySelector<HTMLInputElement>(`#ocr-${key}`);
                input.value = "";
                input.setCustomValidity("");
            });
            return;
        }
        const value: OCRThresholds = {detection: null, box: null, recognition: null};
        for (const {key} of fields) {
            const input = dialog.element.querySelector<HTMLInputElement>(`#ocr-${key}`);
            const number = input.value === "" ? null : Number(input.value);
            const invalid = number !== null && (!Number.isFinite(number) ||
                (key === "recognition" ? number < 0 || number > 1 : number <= 0 || number >= 1));
            input.setCustomValidity(invalid ? languages.ocrThresholdRange : "");
            if (!input.reportValidity()) return;
            value[key] = number;
        }
        saving = true;
        dialog.element.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach(control => { control.disabled = true; });
        try {
            if (await save(value) && !closed) dialog.destroy();
        } finally {
            saving = false;
            if (!closed) {
                dialog.element.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach(control => { control.disabled = false; });
            }
        }
    });
    return dialog;
};
