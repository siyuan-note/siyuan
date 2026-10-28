import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {loadModule} from "../testSupport/loadModule";
import type {OCRThresholds, SettingOCR} from "../types/api";
import {getReasoningEffortOptions} from "../ai/reasoningEffort";
import type {SettingBuilder} from "./setting/builder";
import type {applySettingTabSearchVisibility, clearSettingTabSearch} from "./setting/mount";

const generalRowNames = ["ocrAuto", "ocrProvider", "ocrModel", "ocrImport", "ocrAIModel", "ocrReasoningEffort"];
const advancedRowNames = ["ocrThreshold_detection", "ocrThreshold_box", "ocrThreshold_recognition"];
const tooltipRowNames = ["ocr_showText", "ocr_showEmpty", "ocr_showError"];

test("OCR settings register separate searchable rows in shared desktop and mobile groups", () => {
    const compiled = transpileModule(readFileSync("src/config/ocr.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const languages = new Proxy({}, {get: (_target, key) => String(key)});
    const exports = {} as {registerOCRTab: (tab: unknown) => void};
    runInNewContext(compiled, {exports, window: {siyuan: {languages}}, require: () => ({
        genConfigItemMainHtml: (title: string, desc: string) => `${title} ${desc}`,
        genSwitchRow: (id: string) => `<label><input id="${id}"></label>`,
        genButtonRowHtml: (id: string) => `<label><button id="${id}"></button></label>`,
        genNumberInputHtml: (id: string) => `<input class="b3-text-field" id="${id}" type="number">`,
        openOCRImportModelsDialog: () => ({destroy() {}}),
    })});
    let group = "";
    const groupTitles = new Map<string, string>();
    const rows: Array<{group: string; key: string; keywords: string[]; html: () => string}> = [];
    const tab = {
        group: (id: string, title: string) => { group = id; groupTitles.set(id, title); return tab; },
        slot: (spec: Omit<typeof rows[number], "group">) => { rows.push({...spec, group}); return tab; },
        // 与 SettingGroupBuilder.button 一致：条目 id 为 button_<id>，检索词含标题、按钮文字与补充词
        button: (spec: {id: string, title: string, label: string, keywords?: string[]}) => {
            rows.push({
                group, key: `button_${spec.id}`,
                keywords: [spec.title, spec.label, ...(spec.keywords ?? [])],
                html: () => `<button id="${spec.id}"></button>`,
            });
            return tab;
        },
    };
    exports.registerOCRTab(tab);
    assert.deepEqual(rows.filter(row => row.group === "general").map(row => row.key),
        ["ocrAuto", "ocrProvider", "ocrModel", "button_ocrImport", "ocrAIModel", "ocrReasoningEffort"]);
    const aiRow = rows.find(row => row.key === "ocrAIModel");
    assert.ok(aiRow.keywords.includes("ocrAIModelTip"));
    assert.match(aiRow.html(), /class="b3-select/);
    // 导入设置项就在 OCR 模型后面，不再单独分组，标题、说明与按钮合并在同一项里
    const importRow = rows.find(row => row.key === "button_ocrImport");
    assert.equal(importRow.group, "general");
    assert.equal(groupTitles.has("models"), false);
    assert.ok(importRow.keywords.includes("ocrImportModelsTitle"));
    assert.ok(importRow.keywords.includes("ocrDetector"));
    assert.match(importRow.html(), /<button id="ocrImport"><\/button>/);
    assert.doesNotMatch(importRow.html(), /type="file"/);
    assert.match(readFileSync("src/config/ocr.ts", "utf8"), /openOCRImportModelsDialog\(/);
    const thresholds = rows.filter(row => row.group === "advanced");
    assert.equal(groupTitles.get("advanced"), "ocrThresholdSettings");
    assert.deepEqual(thresholds.map(row => row.key), ["ocrThreshold_detection", "ocrThreshold_box", "ocrThreshold_recognition"]);
    thresholds.forEach(row => assert.match(row.html(), /type="number"/));
    assert.equal(groupTitles.get("tooltip"), "ocrTooltipSettings");
    assert.deepEqual(rows.filter(row => row.group === "tooltip").map(row => row.key), tooltipRowNames);
    rows.filter(row => row.group === "tooltip").forEach(row => assert.ok(row.keywords.length === 2));
    assert.doesNotMatch(readFileSync("src/config/ocr.ts", "utf8"), /openOCRThresholds/);
    const tabs = readFileSync("src/config/setting/tabs.ts", "utf8");
    assert.match(tabs, /ocr: setting\.tab\([\s\S]*?afterMount: mountOCRTab,[\s\S]*?registerOCRTab/);
    assert.match(tabs, /ocr: setting\.tab\([\s\S]*?onShow: updateOCRTabBorders,[\s\S]*?registerOCRTab/);
    assert.match(tabs, /ocr: setting\.tab\([\s\S]*?icon: "iconOCR"/);
    assert.match(readFileSync("appearance/icons/litheness/icon.js", "utf8"), /<symbol id="iconOCR"/);
    assert.match(readFileSync("appearance/icons/index.html", "utf8"), /xlink:href="#iconOCR"/);
    assert.doesNotMatch(readFileSync("src/config/assets.ts", "utf8"), /data-type="ocr"/);
    assert.match(readFileSync("src/mobile/menu/settingPanel.ts", "utf8"), /tabId === "ocr"[\s\S]*?unmountOCRTab\(root\)/);
});

const defaultOCRConfig = (value: Partial<SettingOCR> = {}): SettingOCR => ({
    provider: "paddleocr", model: "tiny", auto: false, aiModelId: "", reasoningEffort: "",
    showText: true, showEmpty: false, showError: false,
    thresholds: {detection: null, box: null, recognition: null}, ...value,
});

const createOCRPanel = async (initial?: {config?: Partial<SettingOCR>}) => {
    const compiled = transpileModule(readFileSync("src/config/ocr.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const config: {ocr: SettingOCR} = {ocr: defaultOCRConfig(initial?.config)};
    let serverConfig = {...config.ocr};
    let models = [{id: "tiny", name: "Tiny", builtIn: true}];
    let aiModels: Array<{id: string; name: string; provider: string}> = [];
    let reads = 0;
    let deferredRead = false;
    const readRequests: Array<(response: unknown) => void> = [];
    const snapshot = () => ({code: 0, data: {config: {...serverConfig},
        providers: [{id: "paddleocr", available: true}, ...(aiModels.length || serverConfig.provider === "ai" ?
            [{id: "ai", available: aiModels.some(model => model.id === serverConfig.aiModelId)}] : [])], models, aiModels}});
    const generalIds = generalRowNames;
    const advancedIds = advancedRowNames;
    const createClassList = () => {
        const classes = new Set<string>();
        return {
            toggle(name: string, value?: boolean) {
                const on = value === undefined ? !classes.has(name) : value;
                if (on) { classes.add(name); } else { classes.delete(name); }
                return on;
            },
            add(name: string) { classes.add(name); },
            remove(...names: string[]) { names.forEach(name => classes.delete(name)); },
            contains(name: string) { return classes.has(name); },
        };
    };
    const controls = Object.fromEntries([...generalIds, ...advancedIds, ...tooltipRowNames].map(id => [id, {
        id, value: id === "ocrProvider" ? "paddleocr" : id === "ocrAIModel" || id === "ocrReasoningEffort" ? "" : "tiny", checked: false, disabled: false, innerHTML: "",
        tagName: id === "ocrImport" ? "BUTTON" : "INPUT",
        validationMessage: "", validity: {badInput: false},
        setCustomValidity(message: string) { this.validationMessage = message; },
        reportValidity() { return !this.validationMessage; },
        classList: createClassList(),
        getAttribute: () => `ocr.__slot.${id === "ocrImport" ? "button_ocrImport" : id}`,
        // 控件自身即配置项，与真实 DOM 中 closest(".config-item") 返回同一元素一致
        closest() { return this as unknown as {classList: ReturnType<typeof createClassList>}; },
    }]));
    const groupElement = (id: string, ids: string[]) => ({
        classList: createClassList(),
        getAttribute: () => id,
        querySelectorAll: () => ids.map(id => controls[id]),
    });
    const groups: Record<string, ReturnType<typeof groupElement>> = {
        general: groupElement("general", generalIds), advanced: groupElement("advanced", advancedIds),
        tooltip: groupElement("tooltip", tooltipRowNames),
    };
    const listeners = new Map<string, (event: unknown) => Promise<void>>();
    let renders = 0;
    const root = {
        get innerHTML() { return "controls"; },
        set innerHTML(_value: string) { renders++; },
        querySelector: (selector: string) => groups[/data-config-group-id="(\w+)"/.exec(selector)?.[1] ?? ""] ?? controls[selector.slice(1)],
        querySelectorAll: (selector: string) => {
            if (selector === "[data-config-search-unavailable-id]") return [];
            if (selector === "[data-config-group-id]") return Object.values(groups);
            if (selector === "[data-config-group-id], [data-config-item-id]") return [...Object.values(groups), ...Object.values(controls)];
            return Object.values(controls);
        },
        addEventListener: (name: string, callback: (event: unknown) => Promise<void>) => listeners.set(name, callback),
    };
    const requests: Array<{
        config: typeof config.ocr;
        resolve: (response: {code: number; data?: typeof config.ocr}) => void;
        reject: (error: Error) => void;
    }> = [];
    const errors: string[] = [];
    const notifications = new Map<string, () => void>();
    const dialogs: Array<{options: {onImported: () => void, onClosed?: () => void}, destroy: () => void}> = [];
    const exports = {} as {
        mountOCRSettings: (element: unknown) => () => void;
        updateOCRTabBorders: (element: HTMLElement) => void;
    };
    runInNewContext(compiled, {exports, AbortController, window: {siyuan: {config, languages: {ocrThresholdRange: "invalid threshold"}},
        addEventListener: (name: string, callback: () => void, options: {signal: AbortSignal}) => {
            notifications.set(name, callback);
            options.signal.addEventListener("abort", () => notifications.delete(name));
        },
    }, require: () => ({
        config: {set: (_path: string, value: typeof config.ocr, applied: (next: typeof config.ocr) => void) => {
            return new Promise<{code: number; data?: typeof config.ocr}>((resolve, reject) => requests.push({config: value, resolve, reject}))
                .then(response => {
                    if (response.code !== 0) throw new Error("save failed");
                    config.ocr = response.data;
                    applied(response.data);
                });
        }},
        OCR_CHANGED_EVENT: "ocr-test",
        AI_CONFIG_CHANGED_EVENT: "ai-test",
        trackSettingSave: (task: Promise<boolean>) => task,
        getReasoningEffortOptions,
        objEquals: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
        fetchSyncPost: (url: string, value: typeof config.ocr) => {
            if (url === "/api/asset/getOCRConfig") {
                reads++;
                if (deferredRead) {
                    deferredRead = false;
                    return new Promise(resolve => readRequests.push(resolve));
                }
                return Promise.resolve(snapshot());
            }
            assert.equal(url, "/api/asset/setOCRConfig");
            return new Promise((resolve, reject) => requests.push({config: value, resolve, reject}));
        },
        escapeAttr: (value: string) => value, escapeHtml: (value: string) => value,
        genConfigItemMainHtml: () => "", genSwitchRow: () => "", genButtonRowHtml: () => "",
        openOCRImportModelsDialog: (options: typeof dialogs[number]["options"]) => {
            const dialog = {options, destroy: () => options.onClosed?.()};
            dialogs.push(dialog);
            return dialog;
        },
        showMessage: (message: string) => errors.push(message),
    })});
    const close = exports.mountOCRSettings(root);
    await new Promise(setImmediate);
    const searchRuntime = loadModule<{
        applySettingTabSearchVisibility: typeof applySettingTabSearchVisibility;
        clearSettingTabSearch: typeof clearSettingTabSearch;
    }>("src/config/setting/mount.ts", {require: () => ({})}, ScriptTarget.ES2021);
    const builderRuntime = loadModule<{SettingBuilder: typeof SettingBuilder}>("src/config/setting/builder.ts", {
        require: (name: string) => name === "./mount" ? searchRuntime : {},
    }, ScriptTarget.ES2021);
    const tab = new builderRuntime.SettingBuilder().tab({
        id: "ocr", icon: "iconOCR", title: () => "OCR", onShow: exports.updateOCRTabBorders,
    }, () => {});
    const inputThreshold = (key: keyof OCRThresholds, value: string, badInput = false) => {
        const control = controls[`ocrThreshold_${key}`];
        control.value = value;
        control.validity.badInput = badInput;
        listeners.get("input")({target: control});
    };
    return {
        controls, config, requests, errors, close, renders: () => renders, dialogs, groups,
        search: (ids: string[]) => tab.mount(root as unknown as HTMLElement, {
            visibleItemIds: new Set(ids.map(id => controls[id].getAttribute())), visibleGroupIds: new Set(["general"]),
        }),
        clearSearch: () => {
            searchRuntime.clearSettingTabSearch(root as unknown as HTMLElement);
            return tab.mount(root as unknown as HTMLElement);
        },
        clickImport: () => listeners.get("click")({target: {closest: () => controls.ocrImport}, stopPropagation() {}}),
        inputThreshold,
        changeThreshold: (key: keyof OCRThresholds, value: string, badInput = false) => {
            inputThreshold(key, value, badInput);
            return listeners.get("change")({target: controls[`ocrThreshold_${key}`], stopPropagation() {}});
        },
        reads: () => reads, snapshot, readRequests,
        notify: () => notifications.get("ocr-test")?.(),
        notifyAI: () => notifications.get("ai-test")?.(),
        setAIModels: (value: typeof aiModels) => { aiModels = value; },
        changeProvider: (value: string) => {
            controls.ocrProvider.value = value;
            return listeners.get("change")({target: controls.ocrProvider, stopPropagation() {}});
        },
        changeEffort: (value: string) => {
            controls.ocrReasoningEffort.value = value;
            return listeners.get("change")({target: controls.ocrReasoningEffort, stopPropagation() {}});
        },
        deferRead: () => { deferredRead = true; },
        updateServer: (next: Partial<typeof config.ocr>) => { serverConfig = defaultOCRConfig(next); },
        addModel: (id: string) => { models = [...models, {id, name: "Imported", builtIn: false}]; },
        changeAuto: (checked: boolean) => {
            controls.ocrAuto.checked = checked;
            return listeners.get("change")({target: controls.ocrAuto, stopPropagation() {}});
        },
        changeTooltip: (key: "showText" | "showEmpty" | "showError", checked: boolean) => {
            const control = controls[`ocr_${key}`];
            control.checked = checked;
            return listeners.get("change")({target: control, stopPropagation() {}});
        },
    };
};

test("OCR tooltip switches save independently, recover after failed saves and receive notifications", async () => {
    const panel = await createOCRPanel();
    assert.equal(panel.controls.ocr_showText.checked, true);
    assert.equal(panel.controls.ocr_showEmpty.checked, false);
    assert.equal(panel.controls.ocr_showError.checked, false);
    const hide = panel.changeTooltip("showText", false);
    await new Promise(setImmediate);
    const empty = panel.changeTooltip("showEmpty", true);
    assert.equal(panel.requests[0].config.auto, false);
    assert.equal(panel.requests[0].config.showText, false);
    assert.equal(panel.controls.ocr_showEmpty.disabled, false);
    panel.requests[0].resolve({code: 0, data: panel.requests[0].config});
    await hide;
    await new Promise(setImmediate);
    assert.equal(panel.requests[1].config.showText, false);
    assert.equal(panel.requests[1].config.showEmpty, true);
    panel.requests[1].resolve({code: 0, data: panel.requests[1].config});
    await empty;
    const error = panel.changeTooltip("showError", true);
    await new Promise(setImmediate);
    panel.requests[2].resolve({code: -1});
    await error;
    assert.equal(panel.controls.ocr_showError.checked, false);
    assert.equal(panel.controls.ocr_showEmpty.checked, true);
    panel.updateServer({provider: "tesseract", model: "tiny", auto: true,
        showText: true, showEmpty: false, showError: true});
    panel.notify();
    await new Promise(setImmediate);
    assert.equal(panel.controls.ocr_showText.checked, true);
    assert.equal(panel.controls.ocr_showEmpty.checked, false);
    assert.equal(panel.controls.ocr_showError.checked, true);
    const automatic = panel.changeAuto(false);
    await new Promise(setImmediate);
    assert.equal(panel.requests[3].config.showText, true);
    assert.equal(panel.requests[3].config.showError, true);
    panel.requests[3].resolve({code: 0, data: panel.requests[3].config});
    await automatic;
    assert.equal(panel.renders(), 0);
    panel.close();
});

test("selecting AI uses a separate model and requires opting into automatic recognition", async () => {
    const panel = await createOCRPanel();
    assert.doesNotMatch(panel.controls.ocrProvider.innerHTML, /value="ai"/);
    panel.updateServer({provider: "paddleocr", model: "tiny", auto: true});
    panel.setAIModels([{id: "vision", name: "Image model", provider: "Provider"}]);
    panel.notifyAI();
    await new Promise(setImmediate);
    assert.match(panel.controls.ocrProvider.innerHTML, /value="ai"/);
    assert.match(panel.controls.ocrAIModel.innerHTML, /value="" disabled/);
    const saving = panel.changeProvider("ai");
    await new Promise(setImmediate);
    assert.equal(panel.requests[0].config.aiModelId, "vision");
    assert.equal(panel.requests[0].config.auto, false);
    panel.requests[0].resolve({code: 0, data: panel.requests[0].config});
    await saving;
    // 可见性与禁用状态以已保存的配置为准
    assert.equal(panel.controls.ocrModel.disabled, true);
    assert.equal(panel.controls.ocrAIModel.disabled, false);
    assert.equal(panel.controls.ocrThreshold_detection.disabled, true);
    assert.doesNotMatch(panel.controls.ocrAIModel.innerHTML, /value=""/);
    const automatic = panel.changeAuto(true);
    await new Promise(setImmediate);
    assert.equal(panel.requests[1].config.aiModelId, "vision");
    assert.equal(panel.requests[1].config.auto, true);
    panel.requests[1].resolve({code: 0, data: panel.requests[1].config});
    await automatic;
    panel.close();
});

test("OCR reasoning effort is saved independently, restored on failure, and refreshed without rebuilding the form", async () => {
    const panel = await createOCRPanel();
    panel.updateServer({provider: "ai", model: "tiny", aiModelId: "vision", reasoningEffort: "low", auto: false});
    panel.setAIModels([{id: "vision", name: "Image model", provider: "Provider"}]);
    panel.notify();
    await new Promise(setImmediate);
    assert.equal(panel.controls.ocrReasoningEffort.value, "low");
    const failed = panel.changeEffort("high");
    await new Promise(setImmediate);
    panel.requests[0].resolve({code: -1});
    await failed;
    assert.equal(panel.controls.ocrReasoningEffort.value, "low");
    const saved = panel.changeEffort("none");
    await new Promise(setImmediate);
    assert.equal(panel.requests[1].config.reasoningEffort, "none");
    assert.equal(panel.requests[1].config.aiModelId, "vision");
    panel.requests[1].resolve({code: 0, data: panel.requests[1].config});
    await saved;
    assert.equal(panel.config.ocr.reasoningEffort, "none");
    panel.close();
});

test("disabled or deleted AI models stay selected without falling back after AI notifications", async () => {
    const panel = await createOCRPanel();
    panel.updateServer({provider: "ai", model: "tiny", aiModelId: "deleted", auto: false});
    panel.setAIModels([{id: "other", name: "Other", provider: "Provider"}]);
    panel.notifyAI();
    await new Promise(setImmediate);
    assert.equal(panel.controls.ocrAIModel.value, "deleted");
    assert.match(panel.controls.ocrAIModel.innerHTML, /value="deleted" disabled/);
    panel.setAIModels([]);
    panel.notifyAI();
    await new Promise(setImmediate);
    assert.equal(panel.controls.ocrProvider.value, "ai");
    assert.equal(panel.controls.ocrAIModel.value, "deleted");
    assert.equal(panel.requests.length, 0);
    panel.close();
});

test("switching to AI preserves an unavailable imported local model independently", async () => {
    const panel = await createOCRPanel();
    const localModel = "a".repeat(64);
    panel.updateServer({provider: "paddleocr", model: localModel, auto: false});
    panel.setAIModels([{id: "vision", name: "Image model", provider: "Provider"}]);
    panel.notify();
    await new Promise(setImmediate);
    assert.match(panel.controls.ocrModel.innerHTML, new RegExp(`value="${localModel}" disabled`));
    const saving = panel.changeProvider("ai");
    await new Promise(setImmediate);
    assert.equal(panel.requests[0].config.model, localModel);
    assert.equal(panel.requests[0].config.aiModelId, "vision");
    panel.requests[0].resolve({code: 0, data: panel.requests[0].config});
    await saving;
    panel.close();
});

test("the first paint hides provider-specific rows before the config response arrives", async () => {
    const visible = (panel: Awaited<ReturnType<typeof createOCRPanel>>) => generalRowNames
        .filter(id => !panel.controls[id].classList.contains("fn__none"));
    // 提供商取自启动配置：AI 不应先显示 PaddleOCR 的模型与导入行
    const ai = await createOCRPanel({config: {provider: "ai", model: "tiny", auto: false}});
    assert.deepEqual(visible(ai), ["ocrAuto", "ocrProvider", "ocrAIModel", "ocrReasoningEffort"]);
    assert.equal(ai.groups.advanced.classList.contains("fn__none"), true);
    ai.close();
    // Tesseract 同理：只保留开关与提供商
    const tesseract = await createOCRPanel({config: {provider: "tesseract", model: "tiny", auto: false}});
    assert.deepEqual(visible(tesseract), ["ocrAuto", "ocrProvider"]);
    assert.equal(tesseract.groups.advanced.classList.contains("fn__none"), true);
    tesseract.close();
    // PaddleOCR 保留模型、导入行与阈值分组
    const paddle = await createOCRPanel({config: {provider: "paddleocr", model: "tiny", auto: false}});
    assert.deepEqual(visible(paddle), ["ocrAuto", "ocrProvider", "ocrModel", "ocrImport"]);
    assert.equal(paddle.groups.advanced.classList.contains("fn__none"), false);
    paddle.close();
    // 配置读取完成后以配置为准
    const replied = await createOCRPanel({config: {provider: "ai", model: "tiny", auto: false}});
    replied.updateServer({provider: "paddleocr", model: "tiny", auto: false});
    replied.notify();
    await new Promise(setImmediate);
    assert.deepEqual(visible(replied), ["ocrAuto", "ocrProvider", "ocrModel", "ocrImport"]);
    replied.close();
});

test("hidden trailing rows keep the last visible OCR row borderless for every provider", async () => {
    const panel = await createOCRPanel();
    const marked = () => Object.values(panel.controls)
        .filter(control => control.classList.contains("b3-label--noborder")).map(control => control.id);
    // PaddleOCR：末尾两项隐藏，导入行成为最后可见项
    assert.deepEqual(marked(), ["ocrImport", "ocrThreshold_recognition", "ocr_showError"]);
    const tesseract = panel.changeProvider("tesseract");
    await new Promise(setImmediate);
    panel.requests[0].resolve({code: 0, data: panel.requests[0].config});
    await tesseract;
    // Tesseract：模型与导入行也隐藏，提供商行成为最后可见项
    assert.deepEqual(marked(), ["ocrProvider", "ocrThreshold_recognition", "ocr_showError"]);
    const ai = panel.changeProvider("ai");
    await new Promise(setImmediate);
    panel.requests[1].resolve({code: 0, data: panel.requests[1].config});
    await ai;
    // AI：末尾两项可见，仅隐藏模型与导入行
    assert.deepEqual(marked(), ["ocrReasoningEffort", "ocrThreshold_recognition", "ocr_showError"]);
    panel.close();
});

for (const [provider, last] of [["paddleocr", "ocrImport"], ["ai", "ocrReasoningEffort"], ["tesseract", "ocrProvider"]]) {
    test(`search changes and clearing after a save restore the last visible row for ${provider}`, async () => {
        const panel = await createOCRPanel({config: {provider, model: "tiny", auto: false}});
        const borderless = () => generalRowNames.filter(id => panel.controls[id].classList.contains("b3-label--noborder"));
        await panel.search(["ocrAuto", "ocrProvider"]);
        assert.deepEqual(borderless(), ["ocrProvider"]);
        await panel.search(["ocrAuto"]);
        assert.deepEqual(borderless(), ["ocrAuto"]);
        const saving = panel.changeAuto(true);
        await new Promise(setImmediate);
        panel.requests[0].resolve({code: 0, data: panel.requests[0].config});
        await saving;
        await panel.clearSearch();
        assert.deepEqual(borderless(), [last]);
        assert.equal(panel.controls.ocrAuto.checked, true);
        assert.equal(panel.renders(), 0);
        panel.close();
    });
}

test("OCR switches save in order without replacing the panel or disabling ordinary controls", async () => {
    const panel = await createOCRPanel();
    const renders = panel.renders();
    const first = panel.changeAuto(true);
    await new Promise(setImmediate);
    assert.equal(panel.controls.ocrAuto.disabled, false);
    assert.equal(panel.controls.ocrProvider.disabled, false);
    assert.equal(panel.controls.ocrModel.disabled, false);
    assert.equal(panel.controls.ocrImport.disabled, true);
    const second = panel.changeAuto(false);
    assert.equal(panel.requests.length, 1);
    panel.requests[0].resolve({code: 0, data: panel.requests[0].config});
    await first;
    await new Promise(setImmediate);
    assert.equal(panel.controls.ocrAuto.checked, false);
    assert.equal(panel.requests.length, 2);
    assert.equal(panel.requests[0].config.auto, true);
    assert.equal(panel.requests[1].config.auto, false);
    panel.requests[1].resolve({code: 0, data: panel.requests[1].config});
    await second;
    assert.equal(panel.config.ocr.auto, false);
    assert.equal(panel.controls.ocrImport.disabled, false);
    assert.equal(panel.renders(), renders);
    panel.close();
});

for (const networkFailure of [false, true]) {
    test(`failed OCR saves restore the saved switch without replacing the panel (network=${networkFailure})`, async () => {
        const panel = await createOCRPanel();
        const renders = panel.renders();
        const pending = panel.changeAuto(true);
        await new Promise(setImmediate);
        if (networkFailure) panel.requests[0].reject(new Error("network"));
        else panel.requests[0].resolve({code: -1});
        await pending;
        assert.equal(panel.controls.ocrAuto.checked, false);
        assert.equal(panel.controls.ocrAuto.disabled, false);
        assert.equal(panel.controls.ocrImport.disabled, false);
        assert.equal(panel.config.ocr.auto, false);
        assert.equal(panel.renders(), renders);
        panel.close();
    });
}

test("inline thresholds receive notifications and save consecutive edits in order", async () => {
    const panel = await createOCRPanel();
    panel.updateServer({provider: "paddleocr", model: "tiny", auto: false,
        thresholds: {detection: 0.4, box: 0.7, recognition: 0.8}});
    panel.notify();
    await new Promise(setImmediate);
    const renders = panel.renders();
    assert.equal(panel.controls.ocrThreshold_box.value, "0.7");
    const saving = panel.changeThreshold("detection", "0.5");
    await new Promise(setImmediate);
    const second = panel.changeThreshold("box", "0.8");
    panel.requests[0].resolve({code: 0, data: panel.requests[0].config});
    await saving;
    await new Promise(setImmediate);
    assert.deepEqual({...panel.requests[1].config.thresholds}, {detection: 0.5, box: 0.8, recognition: 0.8});
    panel.requests[1].resolve({code: 0, data: panel.requests[1].config});
    await second;
    const toggle = panel.changeAuto(true);
    await new Promise(setImmediate);
    assert.equal(panel.requests[2].config.thresholds, undefined);
    panel.requests[2].resolve({code: 0, data: {...panel.requests[2].config, thresholds: panel.config.ocr.thresholds}});
    await toggle;
    assert.equal(panel.config.ocr.thresholds.box, 0.8);
    assert.equal(panel.renders(), renders);
    panel.close();
});

test("inline thresholds reject invalid ranges and partial numbers, retain edits and accept zero confidence", async () => {
    const panel = await createOCRPanel();
    for (const [key, value, badInput] of [
        ["detection", "0", false], ["box", "1", false], ["recognition", "-0.1", false],
        ["recognition", "1.1", false], ["detection", "Infinity", false], ["detection", "", true],
    ] as const) {
        await panel.changeThreshold(key, value, badInput);
        assert.equal(panel.requests.length, 0);
        assert.equal(panel.controls[`ocrThreshold_${key}`].validationMessage, "invalid threshold");
        panel.notify();
        await new Promise(setImmediate);
        assert.equal(panel.controls[`ocrThreshold_${key}`].value, value);
    }
    const zero = panel.changeThreshold("recognition", "0");
    await new Promise(setImmediate);
    assert.equal(panel.requests[0].config.thresholds.recognition, 0);
    panel.requests[0].resolve({code: 0, data: panel.requests[0].config});
    await zero;
    assert.equal(panel.controls.ocrThreshold_recognition.value, "0");
    const defaults = panel.changeThreshold("recognition", "");
    await new Promise(setImmediate);
    assert.equal(panel.requests[1].config.thresholds.recognition, null);
    panel.requests[1].resolve({code: 0, data: panel.requests[1].config});
    await defaults;
    assert.equal(panel.controls.ocrThreshold_recognition.value, "");
    panel.close();
});

test("failed inline saves restore confirmed values while preserving new input during an in-flight save", async () => {
    const panel = await createOCRPanel();
    panel.updateServer({provider: "paddleocr", model: "tiny", auto: false,
        thresholds: {detection: 0.4, box: 0.7, recognition: 0.8}});
    panel.notify();
    await new Promise(setImmediate);
    const saving = panel.changeThreshold("box", "0.9");
    await new Promise(setImmediate);
    panel.inputThreshold("detection", "0.6");
    panel.requests[0].resolve({code: -1});
    await saving;
    assert.equal(panel.controls.ocrThreshold_box.value, "0.7");
    assert.equal(panel.controls.ocrThreshold_detection.value, "0.6");
    panel.updateServer({...panel.config.ocr, thresholds: {detection: 0.3, box: 0.5, recognition: 0.9}});
    panel.notify();
    await new Promise(setImmediate);
    assert.equal(panel.controls.ocrThreshold_detection.value, "0.6");
    assert.equal(panel.controls.ocrThreshold_box.value, "0.5");
    const next = panel.changeThreshold("box", "0.8");
    await new Promise(setImmediate);
    assert.deepEqual({...panel.requests[1].config.thresholds}, {detection: 0.3, box: 0.8, recognition: 0.9});
    panel.requests[1].resolve({code: 0, data: panel.requests[1].config});
    await next;
    assert.equal(panel.controls.ocrThreshold_detection.value, "0.6");
    panel.close();
});

test("undoing an uncommitted threshold edit resumes updates from another window", async () => {
    const panel = await createOCRPanel();
    panel.inputThreshold("detection", "0.6");
    panel.inputThreshold("detection", "");
    panel.updateServer({provider: "paddleocr", model: "tiny", auto: false,
        thresholds: {detection: 0.4, box: 0.7, recognition: 0.8}});
    panel.notify();
    await new Promise(setImmediate);
    assert.equal(panel.controls.ocrThreshold_detection.value, "0.4");
    assert.equal(panel.requests.length, 0);
    panel.close();
});

test("closing the OCR panel cancels queued saves while confirmed shared configuration remains synchronized", async () => {
    const panel = await createOCRPanel();
    const first = panel.changeAuto(true);
    await new Promise(setImmediate);
    const second = panel.changeAuto(false);
    panel.close();
    panel.requests[0].resolve({code: 0, data: panel.requests[0].config});
    await Promise.all([first, second]);
    assert.equal(panel.requests.length, 1);
    assert.equal(panel.config.ocr.auto, true);
    assert.equal(panel.controls.ocrAuto.checked, false);
});

test("OCR notifications update configuration and model options without replacing the form", async () => {
    const panel = await createOCRPanel();
    const renders = panel.renders();
    panel.updateServer({provider: "paddleocr", model: "imported", auto: true});
    panel.addModel("imported");
    panel.notify();
    await new Promise(setImmediate);
    assert.equal(panel.controls.ocrAuto.checked, true);
    assert.equal(panel.controls.ocrModel.value, "imported");
    assert.match(panel.controls.ocrModel.innerHTML, /value="imported"/);
    assert.equal(panel.renders(), renders);
    const reads = panel.reads();
    panel.close();
    panel.notify();
    await new Promise(setImmediate);
    assert.equal(panel.reads(), reads);
});

test("a notification read received during a save cannot overwrite the pending switch", async () => {
    const panel = await createOCRPanel();
    const stale = panel.snapshot();
    panel.deferRead();
    panel.notify();
    await new Promise(setImmediate);
    const pending = panel.changeAuto(true);
    await new Promise(setImmediate);
    panel.readRequests[0](stale);
    await new Promise(setImmediate);
    assert.equal(panel.controls.ocrAuto.checked, true);
    panel.updateServer({provider: "paddleocr", model: "tiny", auto: true});
    panel.requests[0].resolve({code: 0, data: panel.requests[0].config});
    await pending;
    await new Promise(setImmediate);
    assert.equal(panel.config.ocr.auto, true);
    assert.equal(panel.controls.ocrAuto.checked, true);
    assert.equal(panel.reads(), 3);
    panel.close();
});

test("OCR notifications coalesce and discard a superseded response", async () => {
    const panel = await createOCRPanel();
    const stale = panel.snapshot();
    panel.deferRead();
    panel.notify();
    await new Promise(setImmediate);
    panel.updateServer({provider: "paddleocr", model: "tiny", auto: true});
    panel.notify();
    panel.notify();
    panel.readRequests[0](stale);
    await new Promise(setImmediate);
    assert.equal(panel.controls.ocrAuto.checked, true);
    assert.equal(panel.reads(), 3);
    panel.close();
});

test("a read started before a save cannot overwrite the completed save", async () => {
    const panel = await createOCRPanel();
    const stale = panel.snapshot();
    panel.deferRead();
    panel.notify();
    await new Promise(setImmediate);
    const pending = panel.changeAuto(true);
    await new Promise(setImmediate);
    panel.updateServer({provider: "paddleocr", model: "tiny", auto: true});
    panel.requests[0].resolve({code: 0, data: panel.requests[0].config});
    await pending;
    panel.readRequests[0](stale);
    await new Promise(setImmediate);
    assert.equal(panel.config.ocr.auto, true);
    assert.equal(panel.controls.ocrAuto.checked, true);
    assert.equal(panel.reads(), 3);
    panel.close();
});

test("closing the panel ignores a late notification response", async () => {
    const panel = await createOCRPanel();
    const renders = panel.renders();
    panel.deferRead();
    panel.notify();
    await new Promise(setImmediate);
    panel.updateServer({provider: "paddleocr", model: "tiny", auto: true});
    panel.close();
    panel.readRequests[0](panel.snapshot());
    await new Promise(setImmediate);
    assert.equal(panel.config.ocr.auto, false);
    assert.equal(panel.renders(), renders);
});

test("the import button opens one model dialog and refreshes the model list after importing", async () => {
    const panel = await createOCRPanel();
    panel.clickImport();
    assert.equal(panel.dialogs.length, 1);
    assert.equal(panel.requests.length, 0);
    // 弹窗已打开时不重复打开，也不由面板直接发起导入
    panel.clickImport();
    assert.equal(panel.dialogs.length, 1);
    const reads = panel.reads();
    panel.dialogs[0].options.onImported();
    await new Promise(setImmediate);
    assert.equal(panel.reads(), reads + 1);
    // 关闭后可以重新打开
    panel.dialogs[0].destroy();
    panel.clickImport();
    assert.equal(panel.dialogs.length, 2);
    panel.close();
});

test("closing the panel closes an open import dialog", async () => {
    const panel = await createOCRPanel();
    panel.clickImport();
    let closed = 0;
    panel.dialogs[0].options.onClosed = () => { closed++; };
    panel.close();
    assert.equal(closed, 1);
});
