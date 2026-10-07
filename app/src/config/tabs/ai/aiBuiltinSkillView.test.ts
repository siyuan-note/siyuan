import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import test from "node:test";
import {ModuleKind, transpileModule} from "typescript";
import {setBuiltinSkillEnabled, setUserSkillEnabled} from "./aiSkillState";

class ElementStub {
    innerHTML = "";
    className = "";
    isConnected = true;
    disabled = false;
    checked = true;
    dataset: Record<string, string> = {};
    children: ElementStub[] = [];
    elements: Record<string, ElementStub> = {};
    events: Record<string, (event: unknown) => void> = {};
    onchange: (event: unknown) => void;
    onclick: (event: unknown) => void;
    classes = new Set<string>();
    classList = {
        add: (value: string) => this.classes.add(value),
        remove: (value: string) => this.classes.delete(value),
        contains: (value: string) => this.classes.has(value) || this.className.split(" ").includes(value),
    };
    append(element: ElementStub) { this.children.push(element); }
    closest() { return this; }
    addEventListener(name: string, callback: (event: unknown) => void) { this.events[name] = callback; }
    querySelector(selector: string) { return this.elements[selector]; }
    querySelectorAll() { return this.elements.input ? [this.elements.input] : []; }
}

const loadView = () => {
    const source = readFileSync("src/config/tabs/ai/aiSkillUi.ts", "utf8");
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const root = new ElementStub();
    root.elements["#aiBuiltinSkills"] = new ElementStub();
    root.elements["#aiUserSkills"] = new ElementStub();
    const view = new ElementStub();
    const list = new ElementStub();
    const input = new ElementStub();
    input.dataset = {type: "toggleAgentUserSkill", userSkillId: "builtin:siyuan-plugin-development"};
    view.elements["[data-type='agentUserSkillList']"] = list;
    view.elements.input = input;
    const config = {ai: {agent: {skills: {userEnabled: ["mine"], builtinDisabled: ["builtin:future"]}}}};
    const requests: Array<{url: string; finish: (data?: unknown[]) => void}> = [];
    const patches: Array<{path: string; value: string[]; finish: (success: boolean) => void}> = [];
    const exports: {mountBuiltinSkillsBlock?: (root: ElementStub) => void; mountUserSkillsBlock?: (root: ElementStub) => void} = {};
    runInNewContext(code, {
        exports,
        HTMLElement: ElementStub,
        document: {createElement: () => view},
        window: {siyuan: {config, languages: new Proxy({}, {get: (_object, key) => String(key)})}},
        require: (name: string) => {
            if (name.endsWith("/escape")) return {escapeHtml: (text: string) => text, escapeAttr: (text: string) => text};
            if (name.endsWith("/fetch")) return {fetchPost: (url: string, _data: unknown, callback: (response: unknown) => void) => new Promise<void>(resolve => {
                requests.push({url, finish: data => { if (data) callback({data}); resolve(); }});
            })};
            if (name === "./aiSkillState") return {setBuiltinSkillEnabled, setUserSkillEnabled};
            if (name === "./aiRuntime") return {aiConfigApi: {patch: (path: string, value: string[]) => new Promise<void>(resolve => {
                patches.push({path, value, finish: success => {
                    if (success) config.ai.agent.skills[path.endsWith("builtinDisabled") ? "builtinDisabled" : "userEnabled"] = value;
                    resolve();
                }});
            })}};
            throw new Error(name);
        },
    });
    exports.mountBuiltinSkillsBlock(root);
    exports.mountUserSkillsBlock(root);
    const open = (builtin = true) => root.elements[builtin ? "#aiBuiltinSkills" : "#aiUserSkills"].events.click({});
    const back = () => view.onclick({target: new ElementStub()});
    const toggle = (enabled: boolean) => { input.checked = enabled; view.onchange({target: input}); };
    return {root, view, list, input, config, requests, patches, open, back, toggle};
};

const builtin = {id: "builtin:siyuan-plugin-development", name: "siyuan-plugin-development", description: "official", version: "1.0.0", enabled: true};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("skill settings ignore responses after Back and newer navigation", () => {
    const state = loadView();
    state.open();
    state.back();
    state.requests[0].finish([builtin]);
    assert.equal(state.view.classList.contains("config__view--show"), false);
    assert.equal(state.list.innerHTML, "");
    state.open();
    state.open(false);
    state.requests[2].finish([{id: "mine", name: "Mine", description: "user", enabled: true}]);
    state.requests[1].finish([builtin]);
    assert.match(state.view.innerHTML, /agentUserSkills/);
    assert.match(state.list.innerHTML, /~\/.agents\/skills\/mine/);
    assert.doesNotMatch(state.list.innerHTML, /builtin:/);
    assert.equal(state.root.children.length, 1);
});

test("official skill switches preserve user and unknown settings, prevent repeated saves, and revert failures", async () => {
    const state = loadView();
    state.open();
    assert.equal(state.requests[0].url, "/api/ai/agent/lsBuiltinSkills");
    state.requests[0].finish([builtin]);
    assert.match(state.list.innerHTML, /builtin:siyuan-plugin-development · 1.0.0/);
    assert.doesNotMatch(state.list.innerHTML, /~\/.agents/);
    state.toggle(false);
    state.toggle(true);
    assert.equal(state.patches.length, 1);
    assert.equal(state.patches[0].path, "agent.skills.builtinDisabled");
    assert.deepEqual(state.patches[0].value, ["builtin:future", builtin.id]);
    state.patches[0].finish(false);
    await flush();
    assert.match(state.list.innerHTML, / checked/);
    assert.deepEqual(state.config.ai.agent.skills.userEnabled, ["mine"]);
    assert.deepEqual(state.config.ai.agent.skills.builtinDisabled, ["builtin:future"]);
    state.input.disabled = false;
    state.toggle(false);
    state.patches[1].finish(true);
    await flush();
    assert.doesNotMatch(state.list.innerHTML, / checked/);
    assert.deepEqual(state.config.ai.agent.skills.userEnabled, ["mine"]);
});

test("failed and detached skill views do not leave a loading view or reopen", async () => {
    const state = loadView();
    state.open();
    state.requests[0].finish();
    await flush();
    assert.equal(state.view.classList.contains("config__view--show"), false);
    state.open();
    state.view.isConnected = false;
    state.requests[1].finish([builtin]);
    assert.equal(state.list.innerHTML, "");
});
