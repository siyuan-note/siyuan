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
    checked = false;
    isConnected = true;
    classes = new Set<string>();
    classList = {
        toggle: (name: string, enabled: boolean) => {
            if (enabled) { this.classes.add(name); } else { this.classes.delete(name); }
            return enabled;
        },
        contains: (name: string) => this.classes.has(name),
    };
    dataset: Record<string, string> = {};
    events: Record<string, (event: any) => any> = {};
    listeners = new Map<string, Set<(event: any) => any>>();
    elements: Record<string, ElementStub> = {};
    attributes: Record<string, string> = {};
    emitted: string[] = [];
    focused = false;
    focusOptions?: FocusOptions;
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    dispatchEvent(event: {type: string}) { this.emitted.push(event.type); this.events[event.type]?.(event); }
    addEventListener(name: string, callback: (event: any) => any) {
        if (!this.listeners.has(name)) { this.listeners.set(name, new Set()); }
        this.listeners.get(name).add(callback);
        this.events[name] = (event) => {
            let result: unknown;
            this.listeners.get(name).forEach(listener => { result = listener(event); });
            return result;
        };
    }
    removeEventListener(name: string, callback: (event: any) => any) { this.listeners.get(name)?.delete(callback); }
    querySelector(selector: string) { return this.elements[selector]; }
    querySelectorAll(selector: string): ElementStub[] { return selector === "input, button" ? Object.values(this.elements) : []; }
    closest() { return this; }
    contains(element: ElementStub) { return Object.values(this.elements).includes(element); }
    focus(options?: FocusOptions) { this.focused = true; this.focusOptions = options; }
}

const loadUI = (provider = "openai", enabled = true, withSwitch = true) => {
    const source = readFileSync(resolve(process.cwd(), "src/config/tabs/ai/aiDecisionUi.ts"), "utf8");
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const profile = {endpoint: "https://type.example", apiKey: "type-key", name: "jev-latest", timeout: 30};
    const decision = {enabled, provider: "typesafe", profiles: {typesafe: profile,
        openai: {...profile, endpoint: "https://open.example", apiKey: "open-key", name: "gpt-6-luna"}}};
    const root = new ElementStub();
    const cards = new ElementStub();
    root.elements["#aiDecisionCards"] = cards;
    const block = new ElementStub();
    root.elements["#aiDecisionCardsBlock"] = block;
    const toggle = new ElementStub();
    toggle.checked = enabled;
    if (withSwitch) { root.elements['[id="ai.decision.enabled"]'] = toggle; }
    const view = new ElementStub();
    for (const selector of [".b3-dialog__body", "[data-type='testResult']", "[data-action='test']", "[data-decision-field='endpoint']"]) {
        view.elements[selector] = new ElementStub();
    }
    view.elements["[data-action='test']"].elements.span = new ElementStub();
    const patches: any[] = [];
    const requests: Array<{body: any; complete: (response: any) => void; fail: () => void; done: () => void}> = [];
    let confirms = 0;
    let removed = false;
    let applySave = true;
    let backLabel = "";
    let opened = 0;
    let pendingSave = Promise.resolve(true);
    let saveReads = 0;
    let finishRemoval: () => void;
    const exports: any = {};
    const windowEvents = new ElementStub();
    const timers: Array<() => void> = [];
    const document = {activeElement: new ElementStub()};
    runInNewContext(code, {
        exports,
        document,
        CustomEvent: class { constructor(public type: string) {} },
        window: {siyuan: {config: {ai: {decision}}, languages: new Proxy({}, {get: (_target, key) => String(key)})},
            setTimeout: (callback: () => void) => timers.push(callback),
            addEventListener: windowEvents.addEventListener.bind(windowEvents),
            removeEventListener: windowEvents.removeEventListener.bind(windowEvents)},
        require: (name: string) => {
            if (name.endsWith("/escape")) { return {escapeHtmlTextAndAttr: (value: string) => value}; }
            if (name.endsWith("/fragments")) { return {genConfigItemMainHtml: () => "", bindPasswordIconaToggle() {}}; }
            if (name.endsWith("/confirmDialog")) { return {confirmDialog: () => confirms++}; }
            if (name.endsWith("/fetch")) {
                return {fetchPost: (_url: string, body: any, complete: (response: any) => void, _headers: unknown, fail: () => void) =>
                    new Promise<void>(done => requests.push({body, complete, fail, done}))};
            }
            if (name === "./aiRuntime") {
                return {AI_CONFIG_CHANGED_EVENT: "ai-config-changed", aiConfigApi: {waitForSave: () => { saveReads++; return pendingSave; }, patch: async (path: string, value: any, applied: () => void) => {
                    patches.push({path, value});
                    if (applySave) { applied(); }
                }}};
            }
            if (name === "./aiProviderUi") {
                return {createProviderView: (_root: unknown, label: string) => {
                    opened++;
                    backLabel = label;
                    root.elements[`[data-decision-profile-view='${provider}'].config__view--show`] = view;
                    return view;
                }, removeProviderView: (_root: unknown, _view?: unknown, callback?: () => void) => {
                    if (!_view) {
                        delete root.elements[".config__view--show:not(.fn__none)"];
                        return;
                    }
                    removed = true;
                    delete root.elements[`[data-decision-profile-view='${provider}'].config__view--show`];
                    finishRemoval = callback;
                }};
            }
            throw new Error(name);
        },
    });
    exports.mountDecisionCards(root);
    const open = () => {
        const target = new ElementStub();
        target.dataset.decisionProvider = provider;
        cards.events.click({target});
    };
    open();
    const click = (action: string) => {
        const target = new ElementStub();
        target.dataset.action = action;
        return view.events.click({target});
    };
    const edit = (key: string, value: string) => view.events.input({target: {dataset: {decisionField: key}, value}});
    const setEnabled = (value: boolean) => {
        decision.enabled = value;
        windowEvents.events["ai-config-changed"]({});
    };
    const toggleEnabled = (value: boolean, save = Promise.resolve(true)) => {
        toggle.checked = value;
        toggle.events.change({});
        pendingSave = save;
    };
    const flushChanges = async () => {
        timers.splice(0).forEach(callback => callback());
        await new Promise<void>(resolve => setImmediate(resolve));
    };
    return {exports, decision, patches, requests, view, root, block, cards, toggle, document, click, edit, open,
        setEnabled, toggleEnabled, flushChanges, backLabel, opened: () => opened, saveReads: () => saveReads, finishRemoval: () => finishRemoval(),
        confirms: () => confirms, removed: () => removed, failSave: () => applySave = false};
};

test("disabled decision settings initially hide the entire provider row and ignore card actions", () => {
    const ui = loadUI("openai", false);
    assert.match(ui.exports.genDecisionCardsHtml(), /^<div class="b3-label config-item fn__none" id="aiDecisionCardsBlock">/);
    assert.equal(ui.block.classList.contains("fn__none"), true);
    assert.equal(ui.opened(), 0);
    ui.open();
    ui.cards.events.keydown({key: "Enter", preventDefault: () => assert.fail("disabled cards must ignore keyboard actions")});
    assert.equal(ui.opened(), 0);
    assert.equal(ui.patches.length, 0);
    assert.equal(ui.requests.length, 0);
});

test("switch visibility follows the parent-document pattern without changing saved profiles", () => {
    const ui = loadUI("openai", false);
    const initial = JSON.stringify(ui.decision);
    ui.toggleEnabled(true);
    assert.equal(ui.block.classList.contains("fn__none"), false);
    assert.equal(JSON.stringify(ui.decision), initial);
    ui.open();
    assert.equal(ui.opened(), 0);
    ui.setEnabled(true);
    ui.open();
    assert.equal(ui.opened(), 1);
    assert.doesNotMatch(ui.exports.genDecisionCardsHtml(), /fn__none/);
    ui.toggleEnabled(false);
    assert.equal(ui.block.classList.contains("fn__none"), true);
    assert.equal(ui.view.classList.contains("fn__none"), true);
    ui.setEnabled(false);
    assert.equal(JSON.stringify(ui.decision), initial);
    assert.equal(ui.patches.length, 0);
    assert.equal(ui.requests.length, 0);
});

test("switch saves are observed after full event dispatch rather than an intervening microtask", async () => {
    const ui = loadUI("openai", false);
    ui.toggleEnabled(true);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(ui.saveReads(), 0);
    assert.equal(ui.toggle.checked, true);
    await ui.flushChanges();
    assert.equal(ui.saveReads(), 1);
    assert.equal(ui.toggle.checked, false);
});

test("older enable responses cannot overwrite a newer pending disable", async () => {
    const ui = loadUI("openai", false);
    let enabledSaved: (applied: boolean) => void;
    let disabledSaved: (applied: boolean) => void;
    ui.toggleEnabled(true, new Promise<boolean>(resolve => { enabledSaved = resolve; }));
    await ui.flushChanges();
    ui.toggleEnabled(false, new Promise<boolean>(resolve => { disabledSaved = resolve; }));
    await ui.flushChanges();
    ui.setEnabled(true);
    enabledSaved(true);
    await ui.flushChanges();
    assert.equal(ui.toggle.checked, false);
    assert.equal(ui.block.classList.contains("fn__none"), true);
    ui.open();
    assert.equal(ui.opened(), 0);
    ui.setEnabled(false);
    disabledSaved(true);
    await ui.flushChanges();
    assert.equal(ui.toggle.checked, false);
    assert.equal(ui.block.classList.contains("fn__none"), true);
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.patches.length, 0);
    ui.setEnabled(true);
    assert.equal(ui.toggle.checked, true);
    assert.equal(ui.block.classList.contains("fn__none"), false);
});

test("failed switch saves restore saved visibility and the preserved detail", async () => {
    const ui = loadUI();
    ui.edit("apiKey", "draft-before-failed-disable");
    let finishSave: (applied: boolean) => void;
    ui.toggleEnabled(false, new Promise<boolean>(resolve => { finishSave = resolve; }));
    assert.equal(ui.view.classList.contains("fn__none"), true);
    ui.setEnabled(true);
    assert.equal(ui.toggle.checked, false);
    await ui.click("test");
    await ui.flushChanges();
    finishSave(false);
    await ui.flushChanges();
    assert.equal(ui.toggle.checked, true);
    assert.equal(ui.block.classList.contains("fn__none"), false);
    assert.equal(ui.view.classList.contains("fn__none"), false);
    assert.equal(ui.view.elements["[data-action='test']"].disabled, false);
    assert.equal(ui.requests.length, 0);
    await ui.click("save");
    assert.equal(ui.patches[0].value.profiles.openai.apiKey, "draft-before-failed-disable");
});

test("an unsaved enable switch rolls back without revealing the provider settings", async () => {
    const ui = loadUI("openai", false);
    ui.toggleEnabled(true);
    assert.equal(ui.block.classList.contains("fn__none"), false);
    await ui.flushChanges();
    assert.equal(ui.toggle.checked, false);
    assert.equal(ui.block.classList.contains("fn__none"), true);
    assert.equal(ui.opened(), 0);
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.patches.length, 0);
});

test("paused drafts wait behind other details and resume from their original card", async () => {
    const ui = loadUI();
    ui.edit("apiKey", "paused-draft-key");
    ui.setEnabled(false);
    ui.root.elements[".config__view--show:not(.fn__none)"] = new ElementStub();
    ui.setEnabled(true);
    assert.equal(ui.view.classList.contains("fn__none"), true);
    assert.equal(ui.view.elements["[data-action='test']"].disabled, true);
    await ui.click("save");
    await ui.click("test");
    assert.equal(ui.patches.length, 0);
    assert.equal(ui.requests.length, 0);
    ui.open();
    assert.equal(ui.opened(), 1);
    assert.equal(ui.view.classList.contains("fn__none"), false);
    assert.equal(ui.view.elements["[data-action='test']"].disabled, false);
    assert.equal(ui.view.elements["[data-decision-field='endpoint']"].focusOptions?.preventScroll, true);
    await ui.click("save");
    assert.equal(ui.patches[0].value.profiles.openai.apiKey, "paused-draft-key");
});

test("external disable suspends a detail and restores its unsaved draft without side effects", async () => {
    const ui = loadUI();
    const initialProfiles = JSON.stringify(ui.decision.profiles);
    ui.edit("apiKey", "draft-key");
    ui.document.activeElement = ui.view.elements["[data-decision-field='endpoint']"];
    ui.setEnabled(false);
    assert.equal(ui.toggle.checked, false);
    assert.equal(ui.block.classList.contains("fn__none"), true);
    assert.equal(ui.view.classList.contains("fn__none"), true);
    assert.equal(ui.view.attributes["data-decision-profile-view"], "openai");
    assert.equal(ui.view.elements["[data-action='test']"].disabled, true);
    assert.equal(ui.toggle.focusOptions?.preventScroll, true);
    for (const action of ["test", "save", "use", "cancel", "back"]) { await ui.click(action); }
    ui.edit("apiKey", "disabled-edit");
    ui.open();
    assert.equal(ui.opened(), 1);
    assert.equal(ui.patches.length, 0);
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.removed(), false);
    assert.equal(ui.confirms(), 0);
    assert.deepEqual(ui.root.emitted, []);
    assert.equal(JSON.stringify(ui.decision.profiles), initialProfiles);
    assert.equal(ui.decision.provider, "typesafe");
    ui.setEnabled(true);
    assert.equal(ui.toggle.checked, true);
    assert.equal(ui.block.classList.contains("fn__none"), false);
    assert.equal(ui.view.classList.contains("fn__none"), false);
    assert.equal(ui.view.elements["[data-action='test']"].disabled, false);
    assert.equal(ui.opened(), 1);
    await ui.click("save");
    assert.equal(ui.patches[0].value.profiles.openai.apiKey, "draft-key");
    assert.equal(ui.patches[0].value.provider, undefined);
    assert.equal(ui.patches[0].value.enabled, undefined);
});

test("disable invalidates completed and pending tests even after the detail is re-enabled", async () => {
    const ui = loadUI();
    const result = ui.view.elements["[data-type='testResult']"];
    const completed = ui.click("test");
    ui.requests[0].complete({data: {matched: true}});
    ui.requests[0].done();
    await completed;
    assert.equal(result.textContent, "testConnectionSuccess");
    ui.setEnabled(false);
    assert.equal(result.textContent, "");
    ui.setEnabled(true);
    const pending = ui.click("test");
    ui.toggleEnabled(false);
    ui.setEnabled(false);
    ui.setEnabled(true);
    await ui.flushChanges();
    ui.requests[1].complete({data: {matched: true}});
    ui.requests[1].fail();
    ui.requests[1].done();
    await pending;
    assert.equal(result.textContent, "");
    assert.equal(ui.view.elements["[data-action='test']"].disabled, false);
    assert.equal(ui.requests.length, 2);
    assert.equal(ui.patches.length, 0);
});

test("late test completion keeps controls disabled while the feature is off", async () => {
    const ui = loadUI();
    const pending = ui.click("test");
    ui.setEnabled(false);
    ui.requests[0].complete({data: {matched: true}});
    ui.requests[0].done();
    await pending;
    assert.equal(ui.view.elements["[data-type='testResult']"].textContent, "");
    assert.equal(ui.view.elements["[data-action='test']"].disabled, true);
    assert.equal(ui.view.elements["[data-decision-field='endpoint']"].disabled, true);
});

test("standalone provider rows use saved enablement when no switch is mounted", () => {
    const ui = loadUI("openai", false, false);
    assert.equal(ui.block.classList.contains("fn__none"), true);
    assert.equal(ui.opened(), 0);
    ui.setEnabled(true);
    assert.equal(ui.block.classList.contains("fn__none"), false);
    ui.open();
    assert.equal(ui.opened(), 1);
    ui.setEnabled(false);
    assert.equal(ui.view.classList.contains("fn__none"), true);
    assert.equal(ui.patches.length, 0);
    assert.equal(ui.requests.length, 0);
});

test("decision switch and providers share search keywords while retaining the switch-only save", () => {
    const source = readFileSync("src/config/tabs/ai/aiTab.ts", "utf8");
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const exports: {registerAiTab?: (tab: any) => void} = {};
    const definitions = new Map<string, any>();
    runInNewContext(code, {exports,
        window: {siyuan: {languages: new Proxy({}, {get: (_target, key) => String(key)})}},
        require: () => new Proxy({}, {get: () => (): unknown[] => []})});
    exports.registerAiTab({group: () => new Proxy({}, {get: (_target, method) => (id: string | {key: string}, spec: any) => {
        if (method === "switch") { definitions.set(String(id), spec); }
        if (method === "slot") { definitions.set((id as {key: string}).key, id); }
    }})});
    const toggle = definitions.get("ai.decision.enabled");
    const providers = definitions.get("decisionProviders");
    assert.deepEqual(toggle.keywords, providers.keywords);
    for (const keyword of ["TypeSafe", "OpenAI", "apiKey", "decisionModel"]) {
        assert.ok(toggle.keywords.includes(keyword));
    }
    assert.equal(toggle.save, undefined);
});

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

test("decision cards use transparent bundled provider artwork with square view boxes", () => {
    const ui = loadUI();
    const html = ui.root.elements["#aiDecisionCards"].innerHTML;
    const paths = [...html.matchAll(/<img src="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(paths, ["/stage/images/ai-providers/typesafe.svg", "/stage/images/ai-providers/openai.svg"]);
    assert.equal([...html.matchAll(/<img [^>]*class="config-ai-decision__icon"/g)].length, 2);
    assert.equal(html.includes("#iconBrain"), false);
    assert.match(html, /alt="TypeSafe System One"/);
    assert.match(html, /alt="OpenAI Decisions API \(Beta\)"/);
    for (const path of paths) {
        const svg = readFileSync(resolve(process.cwd(), path.slice(1)), "utf8");
        const viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
        assert.equal(viewBox.length, 4);
        assert.ok(viewBox[2] > 0);
        assert.equal(viewBox[2], viewBox[3]);
        assert.doesNotMatch(svg, /<(?:rect|image)\b|background(?:-color)?\s*[:=]/i);
        assert.match(svg, /<path\b/);
    }
});

test("decision details reuse provider settings groups and compact model testing controls", () => {
    for (const provider of ["typesafe", "openai"]) {
        const ui = loadUI(provider);
        const html = ui.view.elements[".b3-dialog__body"].innerHTML;
        assert.equal(ui.backLabel, "apiProvider");
        assert.equal([...html.matchAll(/class="config-group"/g)].length, 2);
        assert.match(html, /class="config-title">aiProviderSettings<\/div>/);
        assert.match(html, /class="config-title">aiModelSettings<\/div>/);
        const modelStart = html.indexOf('class="config-title">aiModelSettings');
        const providerHTML = html.slice(0, modelStart);
        const modelHTML = html.slice(modelStart);
        assert.match(providerHTML, /data-decision-field="endpoint"/);
        assert.match(providerHTML, /data-decision-field="apiKey"/);
        assert.match(providerHTML, /data-decision-field="timeout"/);
        assert.doesNotMatch(providerHTML, /data-decision-field="name"|data-action="test"/);
        assert.match(providerHTML, provider === "typesafe" ? /TypeSafe System One<br>decisionEndpointTip/
            : /OpenAI Decisions API \(Beta\)<br>decisionOpenAIEndpointTip/);
        assert.doesNotMatch(html, /apiKeyTip|apiModelTip|apiTimeoutTip/);
        assert.match(modelHTML, /class="fn__flex b3-label config-item config-ai-provider__model">\s*<input[^>]*class="b3-text-field fn__flex-1"[^>]*data-decision-field="name"[^>]*>[\s\S]*?data-action="test">\s*<svg class="b3-button__icon"><use xlink:href="#iconPlugZap"/);
        assert.match(modelHTML, /decisionTestDraftTip/);
        for (const action of ["save", "use"]) {
            assert.match(html, new RegExp(`class="b3-button b3-button--text" data-action="${action}"`));
        }
    }
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
    ui.root.elements[".config__view--show:not(.fn__none)"] = new ElementStub();
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
    let notified = 0;
    const root = {dispatchEvent: (event: {type: string, bubbles: boolean}) => {
        assert.equal(connected, false);
        assert.equal(event.type, "siyuan-setting-detail-closed");
        assert.equal(event.bubbles, true);
        notified++;
    }};
    runInNewContext(code, {exports, require: () => ({}), window: {setTimeout: (callback: () => void) => timers.push(callback)},
        CustomEvent: class {constructor(public type: string, public options: {bubbles: boolean}) {} get bubbles() { return this.options.bubbles; }}});
    exports.removeProviderView(root, view, () => {
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
    exports.removeProviderView(root, view, () => { assert.equal(connected, false); completed++; });
    timers.splice(0).forEach(callback => callback());
    transition({propertyName: "opacity"});
    assert.equal(completed, 2);
    assert.equal(notified, 2);
});

test("current test results clear on edits and failures restore the test button", async () => {
    const ui = loadUI();
    const testing = ui.click("test");
    const testButton = ui.view.elements["[data-action='test']"];
    assert.equal(testButton.elements.span.textContent, "testConnectionTesting");
    ui.requests[0].complete({data: {matched: true}});
    ui.requests[0].done();
    await testing;
    assert.equal(testButton.elements.span.textContent, "testConnection");
    assert.equal(testButton.textContent, "");
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
