import type {OCRConfigData, SettingOCR} from "../types/api";
import {fetchSyncPost} from "../util/fetch";
import {ContractFormData} from "../util/contractFormData";
import {escapeAttr, escapeHtml} from "../util/escape";
import {genConfigItemMainHtml, genSwitchRow} from "./render/fragments";
import {genButtonRowHtml} from "./render/render";
import {showMessage} from "../dialog/message";
import {OCR_CHANGED_EVENT} from "./ocrRuntime";
import {objEquals} from "../util/functions";

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
    let pendingSaves = 0;
    let saveQueue = Promise.resolve();
    let refreshPending = false;
    let refreshTask: Promise<void>;
    let writeRevision = 0;
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
        const isPaddleOCR = root.querySelector<HTMLSelectElement>("#ocrProvider").value === "paddleocr";
        ["ocrModel", "ocrImportModels", "ocrImport"].forEach(id => {
            root.querySelector(`#${id}`).closest(".config-item").classList.toggle("fn__none", !isPaddleOCR);
        });
        root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button").forEach(element => {
            element.disabled = busy || (element.tagName === "BUTTON" && pendingSaves > 0);
        });
        root.querySelector<HTMLSelectElement>("#ocrModel").disabled = busy || !isPaddleOCR;
        root.querySelector<HTMLButtonElement>("#ocrImport").disabled = busy || pendingSaves > 0 || !isPaddleOCR || files.some(file => !root.querySelector<HTMLInputElement>(`#${file.id}`).files?.length);
    };
    const providerOptions = () => {
        const providers = [...data.providers].sort((left, right) => Number(right.id === "paddleocr") - Number(left.id === "paddleocr"));
        return providers.map(provider => `<option value="${escapeAttr(provider.id)}" ${data.config.provider === provider.id ? "selected" : ""}>${provider.id === "paddleocr" ? "PaddleOCR" : "Tesseract"}${provider.available ? "" : ` (${escapeHtml(languages.ocrUnavailable)})`}</option>`).join("");
    };
    const modelOptions = () => data.models.map(model => `<option value="${escapeAttr(model.id)}" ${model.id === data.config.model ? "selected" : ""}>${escapeHtml(model.name)}${model.builtIn ? ` (${escapeHtml(languages.builtIn)})` : ""}</option>`).join("");
    const updateForm = (previous: OCRConfigData) => {
        const provider = root.querySelector<HTMLSelectElement>("#ocrProvider");
        const model = root.querySelector<HTMLSelectElement>("#ocrModel");
        if (!objEquals(previous.providers, data.providers)) provider.innerHTML = providerOptions();
        if (!objEquals(previous.models, data.models)) model.innerHTML = modelOptions();
        provider.value = data.config.provider;
        model.value = data.config.model;
        root.querySelector<HTMLInputElement>("#ocrAuto").checked = data.config.auto;
        updateControls();
    };
    const render = () => {
        root.innerHTML = genSwitchRow("ocrAuto", languages.ocrAuto, languages.ocrAutoTip, data.config.auto) +
            selectRow("ocrProvider", languages.ocrProvider, languages.ocrProviderTip, providerOptions()) +
            selectRow("ocrModel", languages.ocrModel, languages.ocrModelTip, modelOptions()) +
            `<div id="ocrImportModels" class="b3-label config-item">${genConfigItemMainHtml(languages.ocrImportModels, languages.ocrImportModelsTip)}
${files.map(file => `<div class="fn__hr"></div><label class="fn__block"><span class="b3-label__text">${file.title}</span><div class="fn__hr--small"></div><input id="${file.id}" class="b3-text-field fn__block" type="file" accept="${file.suffix.split(",").map(suffix => `.${suffix}`).join(",")}"></label>`).join("")}</div>` +
            genButtonRowHtml("ocrImport", "", undefined, languages.import, "iconDownload");
        updateControls();
    };
    const load = (): Promise<void> => {
        refreshPending = true;
        if (refreshTask || closed || busy || pendingSaves > 0) {
            return refreshTask || Promise.resolve();
        }
        // 合并通知，写入期间延后读取，避免旧响应覆盖正在保存的选择。
        refreshTask = (async () => {
            while (refreshPending && !closed && !busy && pendingSaves === 0) {
                refreshPending = false;
                const readRevision = writeRevision;
                const response = await fetchSyncPost("/api/asset/getOCRConfig", {}, undefined, true, controller.signal);
                if (closed) return;
                if (readRevision !== writeRevision || busy || pendingSaves > 0 || refreshPending) {
                    refreshPending = true;
                    continue;
                }
                if (response.code !== 0) {
                    if (!data) root.innerHTML = `<div class="b3-label">${escapeHtml(response.msg)}</div>`;
                    return;
                }
                const previous = data;
                data = response.data;
                window.siyuan.config.ocr = data.config;
                if (previous) updateForm(previous);
                else render();
            }
        })().finally(() => {
            refreshTask = undefined;
            if (refreshPending && !closed && !busy && pendingSaves === 0) {
                void load().catch(handleError);
            }
        });
        return refreshTask;
    };
    const handleError = (error: Error) => {
        if (!closed && error.name !== "AbortError") {
            showMessage(error.message);
        }
    };
    root.innerHTML = "<div class=\"fn__loading\"><img src=\"/stage/loading-pure.svg\"></div>";
    window.addEventListener(OCR_CHANGED_EVENT, () => { void load().catch(handleError); }, {signal: controller.signal});
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
        writeRevision++;
        pendingSaves++;
        updateControls();
        // 串行保存每次选择，保留控件焦点和文件选择，最后一次完成后再校正界面状态。
        const save = async () => {
            try {
                if (closed) {
                    return;
                }
                const response = await fetchSyncPost("/api/asset/setOCRConfig", config, undefined, true, controller.signal);
                if (response.code === 0 && !closed) {
                    data.config = response.data;
                    window.siyuan.config.ocr = response.data;
                }
            } catch (error) {
                handleError(error);
            } finally {
                pendingSaves--;
                if (!closed && pendingSaves === 0) {
                    root.querySelector<HTMLSelectElement>("#ocrProvider").value = data.config.provider;
                    root.querySelector<HTMLSelectElement>("#ocrModel").value = data.config.model;
                    root.querySelector<HTMLInputElement>("#ocrAuto").checked = data.config.auto;
                    updateControls();
                    if (refreshPending) void load().catch(handleError);
                }
            }
        };
        saveQueue = saveQueue.then(save, save);
        await saveQueue;
    }, {signal: controller.signal});
    root.addEventListener("click", async event => {
        event.stopPropagation();
        const button = (event.target as HTMLElement).closest("button");
        if (!button || busy || pendingSaves > 0 || !data) {
            return;
        }
        if (button.id === "ocrImport") {
            writeRevision++;
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
                    files.forEach(file => { root.querySelector<HTMLInputElement>(`#${file.id}`).value = ""; });
                    await load();
                }
            } catch (error) {
                handleError(error);
            } finally {
                busy = false;
                if (!closed) {
                    updateControls();
                    if (refreshPending) void load().catch(handleError);
                }
            }
        }
    }, {signal: controller.signal});
    void load().catch(error => {
        handleError(error);
        if (!closed && !data) {
            root.innerHTML = `<div class="b3-label">${escapeHtml(error.message)}</div>`;
        }
    });
    return () => {
        closed = true;
        controller.abort();
    };
};
