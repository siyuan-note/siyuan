import type {OCRConfigData, OCRThresholds, SettingOCR} from "../types/api";
import {fetchSyncPost} from "../util/fetch";
import {ContractFormData} from "../util/contractFormData";
import {escapeAttr, escapeHtml} from "../util/escape";
import {genConfigItemMainHtml, genSwitchRow} from "./render/fragments";
import {genButtonRowHtml, genNumberInputHtml} from "./render/render";
import {showMessage} from "../dialog/message";
import {OCR_CHANGED_EVENT} from "./ocrRuntime";
import {objEquals} from "../util/functions";
import {AI_CONFIG_CHANGED_EVENT} from "./tabs/ai/aiRuntime";
import type {SettingTabBuilder} from "./setting/builder";
import {trackSettingSave} from "./setting/pending";
import {getReasoningEffortOptions} from "../ai/reasoningEffort";

const mounts = new WeakMap<HTMLElement, () => void>();

export const unmountOCRTab = (root: HTMLElement) => {
    mounts.get(root)?.();
    mounts.delete(root);
};

export const mountOCRTab = (root: HTMLElement) => {
    unmountOCRTab(root);
    mounts.set(root, mountOCRSettings(root));
};

const selectRow = (id: string, title: string, desc: string) =>
    `<label class="fn__flex b3-label config-item">${genConfigItemMainHtml(title, desc)}
<span class="fn__space"></span><select id="${id}" class="b3-select fn__flex-center fn__size200" disabled></select></label>`;

const getModelFiles = () => [
    {id: "detector", title: window.siyuan.languages.ocrDetector, suffix: "onnx"},
    {id: "detectorConfig", title: `${window.siyuan.languages.ocrDetector} - YAML`, suffix: "yml,yaml"},
    {id: "recognizer", title: window.siyuan.languages.ocrRecognizer, suffix: "onnx"},
    {id: "recognizerConfig", title: `${window.siyuan.languages.ocrRecognizer} - YAML`, suffix: "yml,yaml"},
];

const getThresholdFields = () => [
    {key: "detection", title: window.siyuan.languages.ocrDetectionThreshold, placeholder: window.siyuan.languages.ocrModelDefault},
    {key: "box", title: window.siyuan.languages.ocrBoxThreshold, placeholder: window.siyuan.languages.ocrModelDefault},
    {key: "recognition", title: window.siyuan.languages.ocrRecognitionThreshold, placeholder: "0.5"},
] as const;

export const registerOCRTab = (tab: SettingTabBuilder) => {
    const languages = window.siyuan.languages;
    tab.group("general", "OCR").slot({
        key: "ocrAuto",
        keywords: [languages.ocrAuto, languages.ocrAutoTip],
        html: () => genSwitchRow("ocrAuto", languages.ocrAuto, languages.ocrAutoTip, false),
    }).slot({
        key: "ocrProvider",
        keywords: ["Tesseract", "PaddleOCR", "AI", languages.ocrProvider, languages.ocrProviderTip],
        html: () => selectRow("ocrProvider", languages.ocrProvider, languages.ocrProviderTip),
    }).slot({
        key: "ocrModel",
        keywords: ["PaddleOCR", "Tiny", languages.ocrModel, languages.ocrModelTip],
        html: () => selectRow("ocrModel", languages.ocrModel, languages.ocrModelTip),
    }).slot({
        key: "ocrAIModel",
        keywords: ["AI", languages.ocrAIModel, languages.ocrAIModelTip],
        html: () => selectRow("ocrAIModel", languages.ocrAIModel, languages.ocrAIModelTip),
    }).slot({
        key: "ocrReasoningEffort",
        keywords: [languages.reasoningEffortTooltip, languages.ocrReasoningEffortTip],
        html: () => selectRow("ocrReasoningEffort", languages.reasoningEffortTooltip, languages.ocrReasoningEffortTip),
    });
    const thresholds = tab.group("advanced", languages.ocrThresholdSettings);
    getThresholdFields().forEach(field => {
        thresholds.slot({
            key: `ocrThreshold_${field.key}`,
            keywords: [field.title, languages.ocrThresholdsTip],
            html: () => `<label class="fn__flex b3-label config-item">${genConfigItemMainHtml(field.title, field.key === "detection" ? languages.ocrThresholdsTip : undefined)}
<span class="fn__space"></span>${genNumberInputHtml(`ocrThreshold_${field.key}`, "", 0, 1, "any")}</label>`,
        });
    });
    tab.group("models", languages.ocrImportModels).slot({
        key: "ocrImportModels",
        keywords: ["ONNX", "YAML", "Tiny", languages.ocrImportModels, languages.ocrDetector, languages.ocrRecognizer],
        html: () => `<div id="ocrImportModels" class="b3-label config-item">${genConfigItemMainHtml(languages.ocrImportModels, languages.ocrImportModelsTip)}
${getModelFiles().map(file => `<div class="fn__hr"></div><label class="fn__block"><span class="b3-label__text">${file.title}</span><div class="fn__hr--small"></div><input id="${file.id}" class="b3-text-field fn__block" type="file" accept="${file.suffix.split(",").map(suffix => `.${suffix}`).join(",")}"></label>`).join("")}</div>`,
    }).slot({
        key: "ocrImport",
        keywords: ["ONNX", "YAML", languages.ocrImportModels, languages.import],
        html: () => genButtonRowHtml("ocrImport", "", undefined, languages.import, "iconDownload"),
    });
};

export const mountOCRSettings = (root: HTMLElement): (() => void) => {
    const controller = new AbortController();
    let closed = false;
    let data: OCRConfigData;
    let busy = false;
    let pendingSaves = 0;
    let saveQueue = Promise.resolve(false);
    let refreshPending = false;
    let refreshTask: Promise<void>;
    let writeRevision = 0;
    const languages = window.siyuan.languages;
    const files = getModelFiles();
    const thresholdFields = getThresholdFields();
    const dirtyThresholds = new Set<keyof OCRThresholds>();
    let thresholdValues: OCRThresholds;
    const updateThresholdInputs = () => {
        thresholdValues = {
            detection: data.config.thresholds?.detection ?? null,
            box: data.config.thresholds?.box ?? null,
            recognition: data.config.thresholds?.recognition ?? null,
        };
        thresholdFields.forEach(field => {
            if (!dirtyThresholds.has(field.key)) {
                const input = root.querySelector<HTMLInputElement>(`#ocrThreshold_${field.key}`);
                input.value = `${thresholdValues[field.key] ?? ""}`;
                input.setCustomValidity("");
            }
        });
    };
    const updateControls = () => {
        const isPaddleOCR = root.querySelector<HTMLSelectElement>("#ocrProvider").value === "paddleocr";
        const isAI = root.querySelector<HTMLSelectElement>("#ocrProvider").value === "ai";
        ["ocrModel", "ocrImportModels", "ocrImport"].forEach(id => {
            root.querySelector(`#${id}`).closest(".config-item").classList.toggle("fn__none", !isPaddleOCR);
        });
        root.querySelector("#ocrAIModel").closest(".config-item").classList.toggle("fn__none", !isAI);
        root.querySelector("#ocrReasoningEffort").closest(".config-item").classList.toggle("fn__none", !isAI);
        ["advanced", "models"].forEach(group => {
            root.querySelector(`[data-config-group-id="${group}"]`)?.classList.toggle("fn__none", !isPaddleOCR);
        });
        root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button").forEach(element => {
            element.disabled = busy || (element.tagName === "BUTTON" && pendingSaves > 0);
        });
        root.querySelector<HTMLSelectElement>("#ocrModel").disabled = busy || !isPaddleOCR;
        root.querySelector<HTMLSelectElement>("#ocrAIModel").disabled = busy || !isAI;
        root.querySelector<HTMLSelectElement>("#ocrReasoningEffort").disabled = busy || !isAI;
        thresholdFields.forEach(field => {
            root.querySelector<HTMLInputElement>(`#ocrThreshold_${field.key}`).disabled = busy || !isPaddleOCR;
        });
        root.querySelector<HTMLButtonElement>("#ocrImport").disabled = busy || pendingSaves > 0 || !isPaddleOCR || files.some(file => !root.querySelector<HTMLInputElement>(`#${file.id}`).files?.length);
    };
    const providerOptions = () => {
        const providers = [...data.providers].sort((left, right) => Number(right.id === "paddleocr") - Number(left.id === "paddleocr"));
        return providers.map(provider => `<option value="${escapeAttr(provider.id)}" ${data.config.provider === provider.id ? "selected" : ""}>${provider.id === "paddleocr" ? "PaddleOCR" : provider.id === "ai" ? "AI" : "Tesseract"}${provider.available ? "" : ` (${escapeHtml(languages.ocrUnavailable)})`}</option>`).join("");
    };
    const modelOptions = () => {
        let html = data.models.map(model => `<option value="${escapeAttr(model.id)}" ${model.id === data.config.model ? "selected" : ""}>${escapeHtml(model.name)}${model.builtIn ? ` (${escapeHtml(languages.builtIn)})` : ""}</option>`).join("");
        if (!data.models.some(model => model.id === data.config.model)) {
            html += `<option value="${escapeAttr(data.config.model)}" disabled>${escapeHtml(languages.ocrUnavailable)}</option>`;
        }
        return html;
    };
    const aiModelOptions = () => {
        const models = data.aiModels || [];
        const selected = data.config.aiModelId || "";
        let html = selected ? "" : `<option value="" disabled>${escapeHtml(languages.noModelConfigured)}</option>`;
        if (selected && !models.some(model => model.id === selected)) {
            html += `<option value="${escapeAttr(selected)}" disabled>${escapeHtml(languages.ocrUnavailable)}</option>`;
        }
        const groups = new Map<string, typeof models>();
        models.forEach(model => {
            const group = groups.get(model.provider) || [];
            group.push(model);
            groups.set(model.provider, group);
        });
        groups.forEach((models, provider) => {
            html += `<optgroup label="${escapeAttr(provider)}">${models.map(model =>
                `<option value="${escapeAttr(model.id)}">${escapeHtml(model.name)}</option>`).join("")}</optgroup>`;
        });
        return html;
    };
    const updateForm = (previous: OCRConfigData) => {
        const provider = root.querySelector<HTMLSelectElement>("#ocrProvider");
        const model = root.querySelector<HTMLSelectElement>("#ocrModel");
        if (!objEquals(previous.providers, data.providers)) provider.innerHTML = providerOptions();
        if (!objEquals(previous.models, data.models) || previous.config.model !== data.config.model) model.innerHTML = modelOptions();
        if (!objEquals(previous.aiModels, data.aiModels) || previous.config.aiModelId !== data.config.aiModelId) {
            root.querySelector<HTMLSelectElement>("#ocrAIModel").innerHTML = aiModelOptions();
        }
        provider.value = data.config.provider;
        model.value = data.config.model;
        root.querySelector<HTMLSelectElement>("#ocrAIModel").value = data.config.aiModelId || "";
        root.querySelector<HTMLSelectElement>("#ocrReasoningEffort").value = data.config.reasoningEffort || "";
        root.querySelector<HTMLInputElement>("#ocrAuto").checked = data.config.auto;
        updateThresholdInputs();
        updateControls();
    };
    const render = () => {
        root.querySelector<HTMLSelectElement>("#ocrProvider").innerHTML = providerOptions();
        root.querySelector<HTMLSelectElement>("#ocrModel").innerHTML = modelOptions();
        root.querySelector<HTMLSelectElement>("#ocrAIModel").innerHTML = aiModelOptions();
        root.querySelector<HTMLSelectElement>("#ocrReasoningEffort").innerHTML = getReasoningEffortOptions(languages)
            .map(option => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join("");
        updateForm(data);
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
                    if (!data) showMessage(response.msg);
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
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button").forEach(element => {
        element.disabled = true;
    });
    thresholdFields.forEach(field => {
        root.querySelector<HTMLInputElement>(`#ocrThreshold_${field.key}`).placeholder = field.placeholder;
    });
    window.addEventListener(OCR_CHANGED_EVENT, () => { void load().catch(handleError); }, {signal: controller.signal});
    window.addEventListener(AI_CONFIG_CHANGED_EVENT, () => { void load().catch(handleError); }, {signal: controller.signal});
    const saveConfig = async (thresholds?: OCRThresholds): Promise<boolean> => {
        if (closed || busy || !data) {
            return false;
        }
        const config: SettingOCR = {
            provider: root.querySelector<HTMLSelectElement>("#ocrProvider").value,
            model: root.querySelector<HTMLSelectElement>("#ocrModel").value,
            auto: root.querySelector<HTMLInputElement>("#ocrAuto").checked,
            aiModelId: root.querySelector<HTMLSelectElement>("#ocrAIModel").value,
            reasoningEffort: root.querySelector<HTMLSelectElement>("#ocrReasoningEffort").value,
            thresholds,
        };
        writeRevision++;
        pendingSaves++;
        updateControls();
        // 串行保存每次选择，保留控件焦点和文件选择，最后一次完成后再校正界面状态。
        const save = async () => {
            let saved = false;
            try {
                if (closed) {
                    return false;
                }
                const response = await fetchSyncPost("/api/asset/setOCRConfig", config, undefined, true, controller.signal);
                if (response.code === 0 && !closed) {
                    data.config = response.data;
                    window.siyuan.config.ocr = response.data;
                    saved = true;
                }
            } catch (error) {
                handleError(error);
            } finally {
                pendingSaves--;
                if (!closed && pendingSaves === 0) {
                    root.querySelector<HTMLSelectElement>("#ocrProvider").value = data.config.provider;
                    root.querySelector<HTMLSelectElement>("#ocrModel").value = data.config.model;
                    root.querySelector<HTMLInputElement>("#ocrAuto").checked = data.config.auto;
                    root.querySelector<HTMLSelectElement>("#ocrAIModel").innerHTML = aiModelOptions();
                    root.querySelector<HTMLSelectElement>("#ocrAIModel").value = data.config.aiModelId || "";
                    root.querySelector<HTMLSelectElement>("#ocrReasoningEffort").value = data.config.reasoningEffort || "";
                    updateThresholdInputs();
                    updateControls();
                    if (refreshPending) void load().catch(handleError);
                }
            }
            return saved;
        };
        saveQueue = saveQueue.then(save, save);
        return trackSettingSave(saveQueue);
    };
    root.addEventListener("input", event => {
        const input = event.target as HTMLInputElement;
        const field = thresholdFields.find(field => input.id === `ocrThreshold_${field.key}`);
        if (field) {
            if (input.validity.badInput || input.value !== `${thresholdValues?.[field.key] ?? ""}`) {
                dirtyThresholds.add(field.key);
            } else {
                dirtyThresholds.delete(field.key);
            }
            input.setCustomValidity("");
        }
    }, {signal: controller.signal});
    root.addEventListener("change", async event => {
        event.stopPropagation();
        const target = event.target as HTMLInputElement | HTMLSelectElement;
        if (files.some(file => file.id === target.id)) {
            updateControls();
            return;
        }
        if (!data) return;
        const field = thresholdFields.find(field => target.id === `ocrThreshold_${field.key}`);
        if (field) {
            const input = target as HTMLInputElement;
            const value = input.value === "" ? null : Number(input.value);
            const invalid = input.validity.badInput || value !== null && (!Number.isFinite(value) ||
                (field.key === "recognition" ? value < 0 || value > 1 : value <= 0 || value >= 1));
            input.setCustomValidity(invalid ? languages.ocrThresholdRange : "");
            if (!input.reportValidity()) {
                dirtyThresholds.add(field.key);
                return;
            }
            dirtyThresholds.delete(field.key);
            thresholdValues = {...thresholdValues, [field.key]: value};
            await saveConfig({...thresholdValues});
            return;
        }
        if (target.id === "ocrProvider" && target.value === "ai" && data.config.provider !== "ai") {
            root.querySelector<HTMLInputElement>("#ocrAuto").checked = false;
            if (!data.config.aiModelId && data.aiModels?.length) {
                root.querySelector<HTMLSelectElement>("#ocrAIModel").value = data.aiModels[0].id;
            }
        }
        updateControls();
        await saveConfig();
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
    });
    return () => {
        closed = true;
        controller.abort();
    };
};
