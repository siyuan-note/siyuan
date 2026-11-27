import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (path: string) => transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const harness = () => {
    const controls = new Map<string, {disabled: boolean, checked: boolean, textContent: string,
        addEventListener: (type: string, fn: () => void) => void, click?: () => void}>();
    for (const name of ["select-all", "delete", "scan", "result", "summary"]) {
        const control = {disabled: false, checked: false, textContent: "", addEventListener: (_type: string, fn: () => void) => {
            control.click = fn;
        }, click: undefined as (() => void) | undefined};
        controls.set(name, control);
    }
    let html = "";
    let inputs: Array<{dataset: {id: string}, checked: boolean, disabled: boolean, closest: () => {remove: () => void}}> = [];
    const list = {
        set innerHTML(value: string) {
            html = value;
            inputs = [...value.matchAll(/<input[^>]*data-id="([^"]+)"/g)].map(match => ({
                dataset: {id: match[1]}, checked: false, disabled: false,
                closest: () => ({remove: () => { inputs = inputs.filter(input => input.dataset.id !== match[1]); }}),
            }));
        },
        querySelectorAll: (selector: string) => selector.includes(":checked") ? inputs.filter(input => input.checked) : inputs,
        addEventListener() {},
    };
    const requests: Array<{url: string, payload: {operationID: string}, timeout: number, finish: (data?: unknown, reject?: boolean) => Promise<void>}> = [];
    let options: {content: string, beforeClose: () => boolean, destroyCallback: () => void};
    let confirm: () => Promise<void>;
    let confirmText = "";
    let changes = 0;
    let uuid = 0;
    const forms = {};
    runInNewContext(compile("src/card/flashcardV2Form.ts"), {exports: forms,
        require: () => ({genUUID: () => String(++uuid)})});
    const exports: {openFlashcardV2Cleanup?: (changed: () => void) => void} = {};
    runInNewContext(compile("src/card/flashcardV2Cleanup.ts"), {
        exports, console: {warn() {}},
        window: {siyuan: {languages: new Proxy({flashcardCleanupSummary: "${sources}/${cards}"},
            {get: (target, key: string) => target[key as keyof typeof target] || key})}},
        require: (name: string) => {
            if (name.endsWith("flashcardV2Form")) { return forms; }
            if (name.endsWith("/dialog")) { return {Dialog: class {
                element = {querySelector: (selector: string) => selector === "[data-sources]" ? list :
                    controls.get(selector.slice(6, -1))};
                constructor(value: typeof options) { options = value; }
            }}; }
            if (name.endsWith("confirmDialog")) {
                return {confirmDialog: (options: {text: string, confirm: () => Promise<void>}) => {
                    confirmText = options.text;
                    confirm = options.confirm;
                }};
            }
            if (name.endsWith("escape")) { return {escapeHtml: (s: string) => s.replace(/</g, "&lt;"), escapeAttr: (s: string) => s}; }
            return {fetchPost: (url: string, payload: {operationID: string}, callback: (response: {data: unknown}) => void, _error?: unknown, _fail?: unknown, _headers?: unknown, timeout?: number) =>
                new Promise<void>((resolve, reject) => {
                    requests.push({url, payload, timeout, finish: async (data, fail) => {
                        if (fail) { reject(new Error("offline")); } else { if (data) { callback({data}); } resolve(); }
                        await new Promise(done => setImmediate(done));
                    }});
                })};
        },
    });
    exports.openFlashcardV2Cleanup(() => { changes++; });
    return {requests, controls, html: () => html, inputs: () => inputs, changes: () => changes,
        content: () => options.content, confirmText: () => confirmText,
        close: () => options.beforeClose(), destroy: () => options.destroyCallback(), confirm: () => confirm()};
};

const source = (reason = "missing", revisionID = "r1") => ({sourceID: "source", revisionID,
    blockIDs: ["block"], cardCount: 2, reason});

test("cleanup shows a concise tip and discloses IDs under the status using the shared icon", async () => {
    const ui = harness();
    await ui.requests[0].finish({sources: [source(), {...source("closed"), sourceID: "closed"},
        {...source("unknown"), sourceID: "unknown"}]});
    assert.equal(ui.inputs().length, 1);
    assert.match(ui.content(), /<div class="ft__on-surface">flashcardCleanupScanTip<\/div>/);
    assert.doesNotMatch(ui.content(), /flashcardCleanupTip/);
    assert.match(ui.html(), /<details class="card__v2-cleanup-details">\s*<summary aria-label="flashcardCardSource - flashcardCleanupMissing">/);
    assert.match(ui.html(), /<use xlink:href="#iconRight"><\/use>/);
    assert.doesNotMatch(ui.html(), /<details[^>]* open/);
    assert.match(ui.html(), /flashcardCleanupMissing/);
    assert.match(ui.html(), /riffCard 2/);
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.requests[0].url, "/api/flashcard/inspectInvalidSources");
    ui.inputs()[0].checked = true;
    ui.controls.get("delete").click();
    assert.match(ui.confirmText(), /^flashcardCleanupTip<br>/);
});

test("failed scans retain results and selection, release controls and show a retryable error", async () => {
    const ui = harness();
    await ui.requests[0].finish({sources: [source()]});
    ui.inputs()[0].checked = true;
    const before = ui.html();
    ui.controls.get("scan").click();
    await ui.requests[1].finish(undefined, true);
    assert.equal(ui.html(), before);
    assert.equal(ui.inputs()[0].checked, true);
    assert.equal(ui.controls.get("scan").disabled, false);
    assert.equal(ui.controls.get("result").textContent, "flashcardCleanupUnknown");
});

test("unconfirmed deletion retries reuse identity and preserve selected sources", async () => {
    const ui = harness();
    await ui.requests[0].finish({sources: [source()]});
    ui.inputs()[0].checked = true;
    ui.controls.get("delete").click();
    const first = ui.confirm();
    await ui.requests[1].finish();
    await first;
    assert.equal(ui.controls.get("result").textContent, "flashcardCleanupUnknown · refresh");
    assert.equal(ui.inputs()[0].checked, true);
    ui.controls.get("delete").click();
    const retry = ui.confirm();
    assert.equal(ui.requests[1].payload.operationID, ui.requests[2].payload.operationID);
    await ui.requests[2].finish({deleted: ["source"], skipped: []});
    await retry;
    assert.equal(ui.inputs().length, 0);
    ui.close();
    ui.destroy();
    assert.equal(ui.changes(), 1);
});

test("closing immediately prevents late scan rendering and reports late deletion only once", async () => {
    const scan = harness();
    scan.close();
    await scan.requests[0].finish({sources: [source()]});
    assert.equal(scan.html(), "");
    const ui = harness();
    await ui.requests[0].finish({sources: [source()]});
    ui.inputs()[0].checked = true;
    ui.controls.get("delete").click();
    const pending = ui.confirm();
    ui.close();
    await ui.requests[1].finish({deleted: ["source"], skipped: []});
    await pending;
    ui.destroy();
    assert.equal(ui.changes(), 1);
});

test("a newly scanned source revision receives a new deletion identity", async () => {
    const ui = harness();
    await ui.requests[0].finish({sources: [source()]});
    ui.inputs()[0].checked = true;
    ui.controls.get("delete").click();
    const first = ui.confirm();
    await ui.requests[1].finish();
    await first;
    ui.controls.get("scan").click();
    await ui.requests[2].finish({sources: [source("missing", "r2")]});
    ui.inputs()[0].checked = true;
    ui.controls.get("delete").click();
    const second = ui.confirm();
    assert.notEqual(ui.requests[1].payload.operationID, ui.requests[3].payload.operationID);
    await ui.requests[3].finish();
    await second;
});

test("a changed scan snapshot with the same revision receives a new deletion identity", async () => {
    for (const change of [{cardCount: 3}, {blockIDs: ["block", "other"]}, {reason: "unknown"}]) {
        const ui = harness();
        await ui.requests[0].finish({sources: [source()]});
        ui.inputs()[0].checked = true;
        ui.controls.get("delete").click();
        const first = ui.confirm();
        await ui.requests[1].finish();
        await first;
        ui.controls.get("scan").click();
        await ui.requests[2].finish({sources: [{...source(), ...change}]});
        if (change.reason) {
            assert.equal(ui.inputs().length, 0);
            assert.equal(ui.controls.get("delete").disabled, true);
            continue;
        }
        ui.inputs()[0].checked = true;
        ui.controls.get("delete").click();
        const second = ui.confirm();
        assert.notEqual(ui.requests[1].payload.operationID, ui.requests[3].payload.operationID);
        await ui.requests[3].finish();
        await second;
    }
});


test("cleanup bounds requests and refreshes unknown deletion outcomes after closure", async () => {
    const ui = harness();
    assert.equal(ui.requests[0].timeout, 30000);
    await ui.requests[0].finish({sources: [source()]});
    ui.inputs()[0].checked = true;
    ui.controls.get("delete").click();
    const pending = ui.confirm();
    assert.equal(ui.requests[1].timeout, 30000);
    ui.close();
    ui.destroy();
    await ui.requests[1].finish(undefined, true);
    await pending;
    assert.equal(ui.changes(), 1);
});
