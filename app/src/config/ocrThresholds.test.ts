import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {OCRThresholds} from "../types/api";

const createDialog = (mobile = false, initial: OCRThresholds = {detection: 0.4, box: 0.7, recognition: 0.8}) => {
    const compiled = transpileModule(readFileSync("src/config/ocrThresholds.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const inputs = Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, {
        value: value?.toString() ?? "", disabled: false, tagName: "INPUT", message: "",
        setCustomValidity(message: string) { this.message = message; },
        reportValidity() { return !this.message; },
    }]));
    const listeners = new Map<string, (event: unknown) => Promise<void>>();
    let options: {width: string; content: string; destroyCallback: () => void};
    let destroyed = 0;
    let closed = 0;
    class Dialog {
        element = {
            addEventListener: (event: string, listener: (event: unknown) => Promise<void>) => listeners.set(event, listener),
            querySelector: (selector: string) => inputs[selector.substring(5)],
            querySelectorAll: () => Object.values(inputs),
        };
        constructor(value: typeof options) { options = value; }
        destroy() { destroyed++; options.destroyCallback(); }
    }
    const requests: Array<{value: OCRThresholds; resolve: (success: boolean) => void}> = [];
    const exports = {} as {openOCRThresholds: (value: OCRThresholds, save: (value: OCRThresholds) => Promise<boolean>, close: () => void) => Dialog};
    runInNewContext(compiled, {exports, window: {siyuan: {languages: {
        ocrDetectionThreshold: "Detection", ocrBoxThreshold: "Box", ocrRecognitionThreshold: "Recognition",
        ocrThresholdRange: "invalid threshold", default: "Default", configGroupAdvanced: "Advanced",
    }}}, require: () => ({Dialog, isMobile: () => mobile, escapeAttr: (value: string) => value})});
    const dialog = exports.openOCRThresholds(initial, value => new Promise(resolve => requests.push({value, resolve})), () => { closed++; });
    const click = (action: string) => listeners.get("click")({target: {closest: () => ({dataset: {action}})}});
    return {dialog, inputs, requests, click, options, destroyed: () => destroyed, closed: () => closed};
};

for (const mobile of [false, true]) {
    test(`OCR settings use the shared dialog and preserve draft values until confirmed (mobile=${mobile})`, async () => {
        const panel = createDialog(mobile);
        assert.equal(panel.options.width, mobile ? "92vw" : "520px");
        assert.doesNotMatch(panel.options.content, /<details|<summary/);
        assert.match(panel.options.content, /b3-dialog__content/);
        panel.inputs.detection.value = "0.6";
        assert.equal(panel.requests.length, 0);
        const saving = panel.click("save");
        assert.equal(panel.requests[0].value.detection, 0.6);
        assert.equal(panel.requests[0].value.box, 0.7);
        assert.equal(panel.inputs.detection.disabled, true);
        await panel.click("save");
        assert.equal(panel.requests.length, 1);
        panel.requests[0].resolve(true);
        await saving;
        assert.equal(panel.destroyed(), 1);
        assert.equal(panel.closed(), 1);
    });
}

test("reset clears overrides, cancellation does not save, and confirmation persists defaults", async () => {
    const cancelled = createDialog();
    await cancelled.click("reset");
    assert.equal(cancelled.inputs.detection.value, "");
    await cancelled.click("cancel");
    assert.equal(cancelled.requests.length, 0);
    const panel = createDialog();
    await panel.click("reset");
    const saving = panel.click("save");
    assert.equal(JSON.stringify(panel.requests[0].value), JSON.stringify({detection: null, box: null, recognition: null}));
    panel.requests[0].resolve(true);
    await saving;
});

test("invalid thresholds stay editable and cannot be submitted; zero recognition confidence is accepted", async () => {
    const panel = createDialog();
    for (const value of ["0", "1", "-0.1", "NaN", "Infinity"]) {
        panel.inputs.detection.value = value;
        await panel.click("save");
        assert.equal(panel.requests.length, 0);
        assert.equal(panel.inputs.detection.message, "invalid threshold");
    }
    panel.inputs.detection.value = "";
    panel.inputs.recognition.value = "0";
    const saving = panel.click("save");
    assert.equal(panel.requests[0].value.recognition, 0);
    panel.requests[0].resolve(false);
    await saving;
    assert.equal(panel.destroyed(), 0);
    assert.equal(panel.inputs.recognition.disabled, false);
    assert.equal(panel.inputs.recognition.value, "0");
});

test("a late save response cannot close an already destroyed threshold dialog twice", async () => {
    const panel = createDialog();
    const saving = panel.click("save");
    panel.dialog.destroy();
    panel.requests[0].resolve(true);
    await saving;
    assert.equal(panel.destroyed(), 1);
});
