import type {OCRConfigData, SettingOCR} from "../types/api";
import {fetchSyncPost} from "../util/fetch";
import {ContractFormData} from "../util/contractFormData";
import {escapeAttr, escapeHtml} from "../util/escape";
import {genConfigItemMainHtml, genSwitchRow} from "./render/fragments";
import {genButtonRowHtml} from "./render/render";
import {showMessage} from "../dialog/message";

export const ocrSearchStrings = (): string[] => [
    "OCR", "Tesseract", "PaddleOCR", "Tiny", "Small",
    window.siyuan.languages.ocrProvider,
    window.siyuan.languages.ocrModel,
    window.siyuan.languages.ocrAuto,
    window.siyuan.languages.ocrImportModels,
];

export const mountOCRSettings = (root: HTMLElement): (() => void) => {
    const controller = new AbortController();
    let closed = false;
    let data: OCRConfigData;
    let busy = false;
    const languages = window.siyuan.languages;
    const selectRow = (id: string, title: string, desc: string, options: string) =>
        `<label class="fn__flex b3-label config-item">${genConfigItemMainHtml(title, desc)}
<span class="fn__space"></span><select id="${id}" class="b3-select fn__flex-center fn__size200">${options}</select></label>`;
    const files = [
        {id: "detector", title: languages.ocrDetector, suffix: "onnx"},
        {id: "detectorConfig", title: `${languages.ocrDetector} - YAML`, suffix: "yml,yaml"},
        {id: "recognizer", title: languages.ocrRecognizer, suffix: "onnx"},
        {id: "recognizerConfig", title: `${languages.ocrRecognizer} - YAML`, suffix: "yml,yaml"},
    ];
    const updateControls = () => {
        root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button").forEach(element => {
            element.disabled = busy;
        });
        root.querySelector<HTMLSelectElement>("#ocrModel").disabled = busy || data.config.provider !== "paddleocr";
        root.querySelector<HTMLButtonElement>("#ocrImport").disabled = busy || files.some(file => !root.querySelector<HTMLInputElement>(`#${file.id}`).files?.length);
    };
    const render = () => {
        root.innerHTML = selectRow("ocrProvider", languages.ocrProvider, languages.ocrProviderTip,
            data.providers.map(provider => `<option value="${escapeAttr(provider.id)}" ${data.config.provider === provider.id ? "selected" : ""}>${provider.id === "paddleocr" ? "PaddleOCR" : "Tesseract"}${provider.available ? "" : ` (${escapeHtml(languages.ocrUnavailable)})`}</option>`).join("")) +
            selectRow("ocrModel", languages.ocrModel, languages.ocrModelTip,
                data.models.map(model => `<option value="${escapeAttr(model.id)}" ${model.id === data.config.model ? "selected" : ""}>${escapeHtml(model.name)}${model.builtIn ? ` (${escapeHtml(languages.builtIn)})` : ""}</option>`).join("")) +
            genSwitchRow("ocrAuto", languages.ocrAuto, languages.ocrAutoTip, data.config.auto) +
            `<div class="b3-label b3-label--inner">${genConfigItemMainHtml(languages.ocrImportModels, languages.ocrImportModelsTip)}
${files.map(file => `<label class="fn__block"><span class="b3-label__text">${file.title}</span><input id="${file.id}" class="b3-text-field fn__block" type="file" accept="${file.suffix.split(",").map(suffix => `.${suffix}`).join(",")}"></label>`).join("")}</div>` +
            genButtonRowHtml("ocrImport", "", undefined, languages.import, "iconDownload") +
            genButtonRowHtml("ocrRefresh", "", undefined, languages.refresh, "iconRefresh");
        updateControls();
    };
    const load = async () => {
        const response = await fetchSyncPost("/api/asset/getOCRConfig", {}, undefined, true, controller.signal);
        if (closed || response.code !== 0) {
            if (!closed && !data) {
                root.innerHTML = `<div class="b3-label">${escapeHtml(response.msg)}</div>`;
            }
            return;
        }
        data = response.data;
        render();
    };
    const handleError = (error: Error) => {
        if (!closed && error.name !== "AbortError") {
            showMessage(error.message);
        }
    };
    root.innerHTML = "<div class=\"fn__loading\"><img src=\"/stage/loading-pure.svg\"></div>";
    root.addEventListener("change", async event => {
        event.stopPropagation();
        const target = event.target as HTMLInputElement | HTMLSelectElement;
        if (busy || !data) {
            return;
        }
        if (files.some(file => file.id === target.id)) {
            updateControls();
            return;
        }
        const config: SettingOCR = {
            provider: root.querySelector<HTMLSelectElement>("#ocrProvider").value,
            model: root.querySelector<HTMLSelectElement>("#ocrModel").value,
            auto: root.querySelector<HTMLInputElement>("#ocrAuto").checked,
        };
        busy = true;
        updateControls();
        try {
            const response = await fetchSyncPost("/api/asset/setOCRConfig", config, undefined, true, controller.signal);
            if (response.code === 0) {
                data.config = response.data;
                window.siyuan.config.ocr = response.data;
            }
        } catch (error) {
            handleError(error);
        } finally {
            busy = false;
            if (!closed) {
                root.querySelector<HTMLSelectElement>("#ocrProvider").value = data.config.provider;
                root.querySelector<HTMLSelectElement>("#ocrModel").value = data.config.model;
                root.querySelector<HTMLInputElement>("#ocrAuto").checked = data.config.auto;
                updateControls();
            }
        }
    }, {signal: controller.signal});
    root.addEventListener("click", async event => {
        event.stopPropagation();
        const button = (event.target as HTMLElement).closest("button");
        if (!button || busy || !data) {
            return;
        }
        if (button.id === "ocrRefresh") {
            busy = true;
            updateControls();
            try {
                await load();
            } catch (error) {
                handleError(error);
            } finally {
                busy = false;
                if (!closed) {
                    updateControls();
                }
            }
        } else if (button.id === "ocrImport") {
            busy = true;
            updateControls();
            try {
                const response = await fetchSyncPost("/api/asset/importOCRModels", new ContractFormData({
                    detector: root.querySelector<HTMLInputElement>("#detector").files[0],
                    detectorConfig: root.querySelector<HTMLInputElement>("#detectorConfig").files[0],
                    recognizer: root.querySelector<HTMLInputElement>("#recognizer").files[0],
                    recognizerConfig: root.querySelector<HTMLInputElement>("#recognizerConfig").files[0],
                }), undefined, true, controller.signal);
                if (response.code === 0 && !closed) {
                    showMessage(languages.imported);
                    await load();
                }
            } catch (error) {
                handleError(error);
            } finally {
                busy = false;
                if (!closed) {
                    updateControls();
                }
            }
        }
    }, {signal: controller.signal});
    void load().catch(error => {
        handleError(error);
        if (!closed) {
            root.innerHTML = `<div class="b3-label">${escapeHtml(error.message)}</div>`;
        }
    });
    return () => {
        closed = true;
        controller.abort();
    };
};
