import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const createOCRPanel = async () => {
    const compiled = transpileModule(readFileSync("src/config/ocr.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const config = {ocr: {provider: "paddleocr", model: "small", auto: false}};
    let serverConfig = {...config.ocr};
    let models = [{id: "small", name: "Small", builtIn: true}];
    let reads = 0;
    let deferredRead = false;
    const readRequests: Array<(response: unknown) => void> = [];
    const snapshot = () => ({code: 0, data: {config: {...serverConfig},
        providers: [{id: "paddleocr", available: true}], models}});
    const controls = Object.fromEntries([
        "ocrProvider", "ocrModel", "ocrAuto", "ocrImportModels", "ocrImport",
        "detector", "detectorConfig", "recognizer", "recognizerConfig",
    ].map(id => [id, {
        id, value: id === "ocrProvider" ? "paddleocr" : "small", checked: false, disabled: false, innerHTML: "",
        files: [{name: `${id}.onnx`}],
        tagName: id === "ocrImport" ? "BUTTON" : "INPUT",
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
    const exports = {} as {mountOCRSettings: (element: unknown) => () => void};
    runInNewContext(compiled, {exports, AbortController, window: {siyuan: {config, languages: {}},
        addEventListener: (name: string, callback: () => void, options: {signal: AbortSignal}) => {
            notifications.set(name, callback);
            options.signal.addEventListener("abort", () => notifications.delete(name));
        },
    }, require: () => ({
        OCR_CHANGED_EVENT: "ocr-test",
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
        reads: () => reads, snapshot, readRequests,
        notify: () => notifications.get("ocr-test")?.(),
        deferRead: () => { deferredRead = true; },
        updateServer: (next: typeof config.ocr) => { serverConfig = next; },
        addModel: (id: string) => { models = [...models, {id, name: "Imported", builtIn: false}]; },
        changeAuto: (checked: boolean) => {
            controls.ocrAuto.checked = checked;
            return listeners.get("change")({target: controls.ocrAuto, stopPropagation() {}});
        },
    };
};

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
    panel.updateServer({provider: "paddleocr", model: "small", auto: true});
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
    panel.updateServer({provider: "paddleocr", model: "small", auto: true});
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
    panel.updateServer({provider: "paddleocr", model: "small", auto: true});
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
    panel.updateServer({provider: "paddleocr", model: "small", auto: true});
    panel.close();
    panel.readRequests[0](panel.snapshot());
    await new Promise(setImmediate);
    assert.equal(panel.config.ocr.auto, false);
    assert.equal(panel.renders(), renders);
});
