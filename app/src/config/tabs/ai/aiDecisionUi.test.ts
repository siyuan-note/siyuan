import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

class ElementStub {
    innerHTML = "";
    textContent = "";
    disabled = false;
    isConnected = true;
    dataset: Record<string, string> = {};
    events: Record<string, (event: any) => any> = {};
    elements: Record<string, ElementStub> = {};
    attributes: Record<string, string> = {};
    emitted: string[] = [];
    focused = false;
    focusOptions?: FocusOptions;
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    dispatchEvent(event: {type: string}) { this.emitted.push(event.type); }
    addEventListener(name: string, callback: (event: any) => any) { this.events[name] = callback; }
    querySelector(selector: string) { return this.elements[selector]; }
    querySelectorAll(): ElementStub[] { return []; }
    closest() { return this; }
    focus(options?: FocusOptions) { this.focused = true; this.focusOptions = options; }
}

const loadUI = () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/tabs/ai/aiDecisionUi.ts"), "utf8");
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const profile = {endpoint: "https://type.example", apiKey: "type-key", name: "jev-latest", timeout: 30};
    const decision = {enabled: true, provider: "typesafe", profiles: {typesafe: profile,
        openai: {...profile, endpoint: "https://open.example", apiKey: "open-key", name: "gpt-6-luna"}}};
    const root = new ElementStub();
    const cards = new ElementStub();
    root.elements["#aiDecisionCards"] = cards;
    const view = new ElementStub();
    for (const selector of [".b3-dialog__body", "[data-type='testResult']", "[data-action='test']", "[data-decision-field='endpoint']"]) {
        view.elements[selector] = new ElementStub();
    }
    const patches: any[] = [];
    const requests: Array<{body: any; complete: (response: any) => void; fail: () => void; done: () => void}> = [];
    let confirms = 0;
    let removed = false;
    let applySave = true;
    let finishRemoval: () => void;
    const exports: any = {};
    runInNewContext(code, {
        exports,
        CustomEvent: class { constructor(public type: string) {} },
        window: {siyuan: {config: {ai: {decision}}, languages: new Proxy({}, {get: (_target, key) => String(key)})},
            addEventListener() {}, removeEventListener() {}},
        require: (name: string) => {
            if (name.endsWith("/escape")) { return {escapeHtmlTextAndAttr: (value: string) => value}; }
            if (name.endsWith("/fragments")) { return {genConfigItemMainHtml: () => "", bindPasswordIconaToggle() {}}; }
            if (name.endsWith("/confirmDialog")) { return {confirmDialog: () => confirms++}; }
            if (name.endsWith("/fetch")) {
                return {fetchPost: (_url: string, body: any, complete: (response: any) => void, _headers: unknown, fail: () => void) =>
                    new Promise<void>(done => requests.push({body, complete, fail, done}))};
            }
            if (name === "./aiRuntime") {
                return {aiConfigApi: {patch: async (path: string, value: any, applied: () => void) => {
                    patches.push({path, value});
                    if (applySave) { applied(); }
                }}};
            }
            if (name === "./aiProviderUi") {
                return {createProviderView: () => view, removeProviderView: (_root: unknown, _view: unknown, callback: () => void) => {
                    removed = true;
                    finishRemoval = callback;
                }};
            }
            throw new Error(name);
        },
    });
    exports.mountDecisionCards(root);
    const target = new ElementStub();
    target.dataset.decisionProvider = "openai";
    cards.events.click({target});
    const click = (action: string) => {
        const target = new ElementStub();
        target.dataset.action = action;
        return view.events.click({target});
    };
    const edit = (key: string, value: string) => view.events.input({target: {dataset: {decisionField: key}, value}});
    return {exports, decision, patches, requests, view, root, click, edit, finishRemoval: () => finishRemoval(),
        confirms: () => confirms, removed: () => removed, failSave: () => applySave = false};
};

test("opening and cancelling a decision card never selects or saves it", async () => {
    const ui = loadUI();
    const endpoint = ui.view.elements["[data-decision-field='endpoint']"];
    assert.equal(endpoint.focused, true);
    assert.equal(endpoint.focusOptions?.preventScroll, true);
    assert.equal(ui.decision.provider, "typesafe");
    assert.equal(ui.patches.length, 0);
    await ui.click("cancel");
    assert.equal(ui.removed(), true);
    assert.equal(ui.patches.length, 0);
});

test("decision cards use bundled provider artwork with square intrinsic dimensions", () => {
    const ui = loadUI();
    const html = ui.root.elements["#aiDecisionCards"].innerHTML;
    const paths = [...html.matchAll(/<img src="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(paths, ["/stage/images/ai-providers/typesafe.png", "/stage/images/ai-providers/openai.svg"]);
    assert.equal(html.includes("#iconBrain"), false);
    assert.match(html, /alt="TypeSafe System One"/);
    assert.match(html, /alt="OpenAI Decisions API \(Beta\)"/);
    const typesafe = readFileSync(resolve(process.cwd(), paths[0].slice(1)));
    assert.equal(typesafe.subarray(1, 4).toString(), "PNG");
    assert.equal(typesafe.readUInt32BE(16), 400);
    assert.equal(typesafe.readUInt32BE(20), 400);
    assert.match(readFileSync(resolve(process.cwd(), paths[1].slice(1)), "utf8"), /viewBox="0 0 24 24"/);
});

test("profile drafts isolate keys and save only the edited provider atomically", async () => {
    const ui = loadUI();
    ui.edit("apiKey", "new-open-key");
    assert.equal(ui.decision.profiles.openai.apiKey, "open-key");
    await ui.click("use");
    assert.equal(ui.patches.length, 1);
    const patch = ui.patches[0];
    assert.equal(patch.path, "decision");
    assert.equal(patch.value.provider, "openai");
    assert.equal(patch.value.profiles.openai.apiKey, "new-open-key");
    assert.equal(patch.value.profiles.typesafe, undefined);
    assert.equal(patch.value.enabled, undefined);
    assert.equal(ui.decision.profiles.typesafe.apiKey, "type-key");
});

test("save alone preserves active selection; failure retains the unsaved draft", async () => {
    const ui = loadUI();
    ui.failSave();
    ui.edit("name", "draft-model");
    await ui.click("save");
    assert.equal(ui.patches[0].value.provider, undefined);
    assert.equal(ui.removed(), false);
    assert.equal(ui.view.elements["[data-type='testResult']"].textContent, "decisionSaveFailed");
    await ui.click("back");
    assert.equal(ui.confirms(), 1);
    assert.equal(ui.removed(), false);
});

test("draft tests send isolated credentials without saving; edits invalidate pending results", async () => {
    const ui = loadUI();
    const testing = ui.click("test");
    await ui.click("test");
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.requests[0].body.provider, "openai");
    assert.equal(ui.requests[0].body.profile.apiKey, "open-key");
    ui.edit("apiKey", "edited-key");
    assert.equal(ui.requests[0].body.profile.apiKey, "open-key");
    ui.requests[0].complete({data: {matched: true}});
    ui.requests[0].done();
    await testing;
    assert.equal(ui.view.elements["[data-type='testResult']"].textContent, "");
    assert.equal(ui.patches.length, 0);
    assert.equal(ui.decision.provider, "typesafe");
    assert.equal(ui.view.elements["[data-action='test']"].disabled, false);
});

test("closing a detail hides late test results", async () => {
    const ui = loadUI();
    const testing = ui.click("test");
    await ui.click("cancel");
    ui.requests[0].complete({data: {matched: true}});
    ui.requests[0].done();
    await testing;
    assert.equal(ui.view.elements["[data-type='testResult']"].textContent, "");
});

test("decision close notification waits until the marked detail is removed", async () => {
    const ui = loadUI();
    assert.equal(ui.view.attributes["data-decision-profile-view"], "openai");
    await ui.click("cancel");
    assert.deepEqual(ui.root.emitted, []);
    ui.finishRemoval();
    assert.deepEqual(ui.root.emitted, ["siyuan-decision-profile-closed"]);
});

test("closing animation never steals focus from a newly opened provider detail", async () => {
    const ui = loadUI();
    const card = new ElementStub();
    ui.root.elements["[data-decision-provider='openai']"] = card;
    await ui.click("cancel");
    ui.root.elements[".config-ai-provider__view.config__view--show"] = new ElementStub();
    ui.finishRemoval();
    assert.equal(card.focused, false);
    assert.deepEqual(ui.root.emitted, ["siyuan-decision-profile-closed"]);
});

test("closing restores card focus only when the settings root is still connected", async () => {
    for (const connected of [true, false]) {
        const ui = loadUI();
        const card = new ElementStub();
        ui.root.elements["[data-decision-provider='openai']"] = card;
        await ui.click("cancel");
        ui.root.isConnected = connected;
        ui.finishRemoval();
        assert.equal(card.focused, connected);
        if (connected) { assert.equal(card.focusOptions?.preventScroll, true); }
        assert.deepEqual(ui.root.emitted, ["siyuan-decision-profile-closed"]);
    }
});

test("provider view removal invokes its completion once after animation or timeout", () => {
    const source = readFileSync("src/config/tabs/ai/aiProviderUi.ts", "utf8");
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const timers: Array<() => void> = [];
    let transition: (event: {propertyName: string}) => void;
    let connected = true;
    let completed = 0;
    const view = {classList: {remove() {}}, remove: () => connected = false,
        addEventListener: (_name: string, callback: typeof transition) => transition = callback};
    const exports: {removeProviderView?: (root: unknown, view: unknown, callback: () => void) => void} = {};
    runInNewContext(code, {exports, require: () => ({}), window: {setTimeout: (callback: () => void) => timers.push(callback)}});
    exports.removeProviderView({}, view, () => {
        assert.equal(connected, false);
        completed++;
    });
    assert.equal(completed, 0);
    transition({propertyName: "transform"});
    assert.equal(completed, 0);
    transition({propertyName: "opacity"});
    assert.equal(completed, 1);
    timers.splice(0).forEach(callback => callback());
    assert.equal(completed, 1);
    connected = true;
    exports.removeProviderView({}, view, () => { assert.equal(connected, false); completed++; });
    timers.splice(0).forEach(callback => callback());
    transition({propertyName: "opacity"});
    assert.equal(completed, 2);
});

test("current test results clear on edits and failures restore the test button", async () => {
    const ui = loadUI();
    const testing = ui.click("test");
    ui.requests[0].complete({data: {matched: true}});
    ui.requests[0].done();
    await testing;
    const result = ui.view.elements["[data-type='testResult']"];
    assert.equal(result.textContent, "testConnectionSuccess");
    ui.edit("endpoint", "https://changed.example");
    assert.equal(result.textContent, "");
    const retry = ui.click("test");
    ui.requests[1].fail();
    ui.requests[1].done();
    await retry;
    assert.equal(result.textContent, "testConnectionFail");
    assert.equal(ui.view.elements["[data-action='test']"].disabled, false);
    assert.equal(ui.patches.length, 0);
});

test("legacy flat configuration supplies only the TypeSafe draft", () => {
    const ui = loadUI();
    const legacy = {endpoint: "https://legacy.example", apiKey: "legacy-key", name: "legacy-model", timeout: 60};
    assert.equal(ui.exports.getDecisionProfileDraft(legacy, "typesafe").apiKey, "legacy-key");
    assert.equal(ui.exports.getDecisionProfileDraft(legacy, "openai").apiKey, "");
    assert.equal(ui.exports.getDecisionProfileDraft(legacy, "openai").name, "gpt-6-luna");
});
