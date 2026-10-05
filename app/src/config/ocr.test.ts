import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {OCRThresholds, SettingOCR} from "../types/api";

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
    })});
    let group = "";
    const rows: Array<{group: string; key: string; keywords: string[]; html: () => string}> = [];
    const tab = {
        group: (id: string) => { group = id; return tab; },
        slot: (spec: Omit<typeof rows[number], "group">) => { rows.push({...spec, group}); return tab; },
    };
    exports.registerOCRTab(tab);
    assert.deepEqual(rows.filter(row => row.group === "general").map(row => row.key),
        ["ocrAuto", "ocrProvider", "ocrModel", "ocrAIModel"]);
    const aiRow = rows.find(row => row.key === "ocrAIModel");
    assert.ok(aiRow.keywords.includes("ocrAIModelTip"));
    assert.match(aiRow.html(), /class="b3-select/);
    assert.deepEqual(rows.filter(row => row.group === "models").map(row => row.key), ["ocrImportModels", "ocrImport"]);
    const tabs = readFileSync("src/config/setting/tabs.ts", "utf8");
    assert.match(tabs, /ocr: setting\.tab\([\s\S]*?afterMount: mountOCRTab,[\s\S]*?registerOCRTab/);
    assert.doesNotMatch(readFileSync("src/config/assets.ts", "utf8"), /data-type="ocr"/);
    assert.match(readFileSync("src/mobile/menu/settingPanel.ts", "utf8"), /tabId === "ocr"[\s\S]*?unmountOCRTab\(root\)/);
});

const createOCRPanel = async () => {
    const compiled = transpileModule(readFileSync("src/config/ocr.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const config: {ocr: SettingOCR} = {ocr: {provider: "paddleocr", model: "tiny", auto: false}};
    let serverConfig = {...config.ocr};
    let models = [{id: "tiny", name: "Tiny", builtIn: true}];
    let aiModels: Array<{id: string; name: string; provider: string}> = [];
    let reads = 0;
    let deferredRead = false;
    const readRequests: Array<(response: unknown) => void> = [];
    const snapshot = () => ({code: 0, data: {config: {...serverConfig},
        providers: [{id: "paddleocr", available: true}, ...(aiModels.length || serverConfig.provider === "ai" ?
            [{id: "ai", available: aiModels.some(model => model.id === serverConfig.aiModelId)}] : [])], models, aiModels}});
    const controls = Object.fromEntries([
        "ocrProvider", "ocrModel", "ocrAIModel", "ocrAuto", "ocrImportModels", "ocrImport",
        "detector", "detectorConfig", "recognizer", "recognizerConfig",
        "ocrAdvanced",
    ].map(id => [id, {
        id, value: id === "ocrProvider" ? "paddleocr" : id === "ocrAIModel" ? "" : "tiny", checked: false, disabled: false, innerHTML: "",
        files: [{name: `${id}.onnx`}],
        tagName: id === "ocrImport" || id === "ocrAdvanced" ? "BUTTON" : "INPUT",
        closest: () => ({classList: {toggle() {}}}),
    }]));
    const listeners = new Map<string, (event: unknown) => Promise<void>>();
    let renders = 0;
    const root = {
        set innerHTML(_value: string) { renders++; },
        querySelector: (selector: string) => controls[selector.slice(1)],
        querySelectorAll: () => Object.values(controls).filter(element => element.id !== "ocrImportModels"),
        addEventListener: (name: string, callback: (event: unknown) => Promise<void>) => listeners.set(name, callback),
    };
    const requests: Array<{
        config: typeof config.ocr;
        resolve: (response: {code: number; data?: typeof config.ocr}) => void;
        reject: (error: Error) => void;
    }> = [];
    const errors: string[] = [];
    const notifications = new Map<string, () => void>();
    let advanced: {initial: OCRThresholds; save: (value: OCRThresholds) => Promise<boolean>; destroy: () => void};
    let dialogCloses = 0;
    const exports = {} as {mountOCRSettings: (element: unknown) => () => void};
    runInNewContext(compiled, {exports, AbortController, window: {siyuan: {config, languages: {ocrThresholdRange: "invalid threshold"}},
        addEventListener: (name: string, callback: () => void, options: {signal: AbortSignal}) => {
            notifications.set(name, callback);
            options.signal.addEventListener("abort", () => notifications.delete(name));
        },
    }, require: () => ({
        OCR_CHANGED_EVENT: "ocr-test",
        AI_CONFIG_CHANGED_EVENT: "ai-test",
        trackSettingSave: (task: Promise<boolean>) => task,
        openOCRThresholds: (initial: OCRThresholds, save: (value: OCRThresholds) => Promise<boolean>, onClose: () => void) => {
            advanced = {initial, save, destroy: () => { dialogCloses++; onClose(); }};
            return advanced;
        },
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
        showMessage: (message: string) => errors.push(message),
    })});
    const close = exports.mountOCRSettings(root);
    await new Promise(setImmediate);
    return {
        controls, config, requests, errors, close, renders: () => renders,
        openAdvanced: () => listeners.get("click")({target: {closest: () => controls.ocrAdvanced}, stopPropagation() {}}),
        advanced: () => advanced, dialogCloses: () => dialogCloses,
        reads: () => reads, snapshot, readRequests,
        notify: () => notifications.get("ocr-test")?.(),
        notifyAI: () => notifications.get("ai-test")?.(),
        setAIModels: (value: typeof aiModels) => { aiModels = value; },
        changeProvider: (value: string) => {
            controls.ocrProvider.value = value;
            return listeners.get("change")({target: controls.ocrProvider, stopPropagation() {}});
        },
        deferRead: () => { deferredRead = true; },
        updateServer: (next: typeof config.ocr) => { serverConfig = next; },
        addModel: (id: string) => { models = [...models, {id, name: "Imported", builtIn: false}]; },
        changeAuto: (checked: boolean) => {
            controls.ocrAuto.checked = checked;
            return listeners.get("change")({target: controls.ocrAuto, stopPropagation() {}});
        },
    };
};

test("selecting AI uses a separate model and requires opting into automatic recognition", async () => {
    const panel = await createOCRPanel();
    assert.doesNotMatch(panel.controls.ocrProvider.innerHTML, /value="ai"/);
    panel.updateServer({provider: "paddleocr", model: "tiny", auto: true});
    panel.setAIModels([{id: "vision", name: "Image model", provider: "Provider"}]);
    panel.notifyAI();
    await new Promise(setImmediate);
    assert.match(panel.controls.ocrProvider.innerHTML, /value="ai"/);
    const saving = panel.changeProvider("ai");
    await new Promise(setImmediate);
    assert.equal(panel.requests[0].config.aiModelId, "vision");
    assert.equal(panel.requests[0].config.auto, false);
    assert.equal(panel.controls.ocrModel.disabled, true);
    assert.equal(panel.controls.ocrAIModel.disabled, false);
    panel.requests[0].resolve({code: 0, data: panel.requests[0].config});
    await saving;
    const automatic = panel.changeAuto(true);
    await new Promise(setImmediate);
    assert.equal(panel.requests[1].config.aiModelId, "vision");
    assert.equal(panel.requests[1].config.auto, true);
    panel.requests[1].resolve({code: 0, data: panel.requests[1].config});
    await automatic;
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

test("OCR switches save in order without replacing the panel or disabling ordinary controls", async () => {
    const panel = await createOCRPanel();
    const renders = panel.renders();
    const files = panel.controls.detector.files;
    const first = panel.changeAuto(true);
    await new Promise(setImmediate);
    assert.equal(panel.controls.ocrAuto.disabled, false);
    assert.equal(panel.controls.ocrProvider.disabled, false);
    assert.equal(panel.controls.ocrModel.disabled, false);
    assert.equal(panel.controls.detector.disabled, false);
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
    assert.equal(panel.controls.detector.files, files);
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

test("advanced OCR settings receive the latest thresholds and use the panel save queue", async () => {
    const panel = await createOCRPanel();
    panel.updateServer({provider: "paddleocr", model: "tiny", auto: false,
        thresholds: {detection: 0.4, box: 0.7, recognition: 0.8}});
    panel.notify();
    await new Promise(setImmediate);
    const renders = panel.renders();
    await panel.openAdvanced();
    assert.equal(panel.advanced().initial.box, 0.7);
    const saving = panel.advanced().save({detection: 0.5, box: 0.8, recognition: 0.9});
    await new Promise(setImmediate);
    panel.requests[0].resolve({code: 0, data: panel.requests[0].config});
    assert.equal(await saving, true);
    assert.equal(panel.config.ocr.thresholds.recognition, 0.9);
    const toggle = panel.changeAuto(true);
    await new Promise(setImmediate);
    assert.equal(panel.requests[1].config.thresholds, undefined);
    panel.requests[1].resolve({code: 0, data: {...panel.requests[1].config, thresholds: panel.config.ocr.thresholds}});
    await toggle;
    assert.equal(panel.config.ocr.thresholds.recognition, 0.9);
    assert.equal(panel.renders(), renders);
    panel.close();
    assert.equal(panel.dialogCloses(), 1);
});

test("closing the OCR panel cancels queued saves and ignores a late response", async () => {
    const panel = await createOCRPanel();
    const first = panel.changeAuto(true);
    await new Promise(setImmediate);
    const second = panel.changeAuto(false);
    panel.close();
    panel.requests[0].resolve({code: 0, data: panel.requests[0].config});
    await Promise.all([first, second]);
    assert.equal(panel.requests.length, 1);
    assert.equal(panel.config.ocr.auto, false);
});

test("OCR notifications update configuration and model options without replacing the form or file choices", async () => {
    const panel = await createOCRPanel();
    const renders = panel.renders();
    const files = panel.controls.detector.files;
    panel.updateServer({provider: "paddleocr", model: "imported", auto: true});
    panel.addModel("imported");
    panel.notify();
    await new Promise(setImmediate);
    assert.equal(panel.controls.ocrAuto.checked, true);
    assert.equal(panel.controls.ocrModel.value, "imported");
    assert.match(panel.controls.ocrModel.innerHTML, /value="imported"/);
    assert.equal(panel.controls.detector.files, files);
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
