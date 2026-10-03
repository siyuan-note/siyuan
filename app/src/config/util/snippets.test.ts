import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const fixture = () => {
    const elements = new Map<string, {id: string; tagName: string; textContent?: string; text?: string; nonce?: string}>();
    const requests: {complete: (snippets: unknown[]) => void}[] = [];
    let allowed = true;
    let measurements = 0;
    const executed: string[] = [];
    const config = {snippet: {enabledCSS: true, enabledJS: true}};
    const exports = {} as typeof import("./snippets");
    runInNewContext(transpileModule(readFileSync("src/config/util/snippets.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, AbortController, window: {siyuan: {config}, setTimeout, clearTimeout},
        document: {
            getElementById: (id: string) => elements.get(id),
            querySelectorAll: () => [...elements.values()],
            createElement: (tag: string) => ({id: "", tagName: tag.toUpperCase(), textContent: "", nonce: "",
                get text() { return this.textContent; }, set text(value: string) { this.textContent = value; },
                remove() { elements.delete(this.id); }}),
            head: {appendChild: (element: {id: string; tagName: string; text: string}) => {
                elements.set(element.id, element);
                if (element.tagName === "SCRIPT") executed.push(element.text);
            }},
        }, require: () => ({
            getHostCapabilities: () => ({customAppearance: allowed}), getExtensionScriptNonce: () => "extension-nonce",
            refreshHeadingNumberMeasurements: () => { measurements++; },
            fetchPost: (_url: string, _data: unknown, callback: (response: unknown) => void) => new Promise<void>(resolve => {
                requests.push({complete: snippets => { callback({data: {snippets}}); resolve(); }});
            }),
        })});
    const render = async (snippets: unknown[], active = () => true) => {
        const pending = exports.renderSnippet(0, active);
        requests.at(-1).complete(snippets);
        await pending;
    };
    return {exports, config, elements, requests, executed, render, setAllowed: (value: boolean) => { allowed = value; },
        measurements: () => measurements};
};

test("shared snippet renderer preserves CSS, JS enable flags, nonce and unchanged script semantics", async () => {
    const f = fixture();
    const css = {id: "css", type: "css", enabled: true, content: "body {color: red;}"};
    const js = {id: "js", type: "js", enabled: true, content: "window.customSetting = true;"};
    await f.render([css, js]);
    assert.equal(f.elements.get("snippetCSScss").textContent, css.content);
    assert.equal(f.elements.get("snippetJSjs").nonce, "extension-nonce");
    assert.deepEqual(f.executed, [js.content]);
    assert.equal(f.measurements(), 1);
    await f.render([css, js]);
    assert.equal(f.executed.length, 1);
    assert.equal(f.measurements(), 1);
    f.config.snippet.enabledJS = false;
    await f.render([css, js]);
    assert.equal(f.elements.has("snippetJSjs"), false);
    assert.equal(f.elements.has("snippetCSScss"), true);
    f.config.snippet.enabledCSS = false;
    await f.render([css, js]);
    assert.equal(f.elements.size, 0);
    f.config.snippet.enabledCSS = true;
    f.config.snippet.enabledJS = true;
    await f.render([css, {...js, enabled: false}]);
    assert.equal(f.elements.size, 1);
    await f.render([]);
    assert.equal(f.elements.size, 0);
});

test("snippet capability and active guards prevent fetches and late script/style execution", async () => {
    const f = fixture();
    f.setAllowed(false);
    await f.exports.renderSnippet();
    assert.equal(f.requests.length, 0);
    f.setAllowed(true);
    await f.exports.renderSnippet(0, () => false);
    assert.equal(f.requests.length, 0);
    let active = true;
    const pending = f.exports.renderSnippet(0, () => active);
    active = false;
    f.requests.at(-1).complete([{id: "late", type: "js", enabled: true, content: "late();"}]);
    await pending;
    assert.equal(f.elements.size, 0);
    assert.equal(f.executed.length, 0);
    const untrusted = f.exports.renderSnippet();
    f.setAllowed(false);
    f.requests.at(-1).complete([{id: "late", type: "css", enabled: true, content: "body {}"}]);
    await untrusted;
    assert.equal(f.elements.size, 0);
});

test("CSS-only snippets never load JS dependencies and CSS updates survive dependency failure", async () => {
    const f = fixture();
    let dependencies = 0;
    const beforeJS = async () => { dependencies++; throw new Error("Lute failed"); };
    const css = {id: "style", type: "css", enabled: true, content: "body {color: red;}"};
    const onlyCSS = f.exports.renderSnippet(0, () => true, beforeJS);
    f.requests.at(-1).complete([css]);
    await onlyCSS;
    assert.equal(dependencies, 0);
    assert.equal(f.elements.get("snippetCSSstyle").textContent, css.content);
    const withJS = f.exports.renderSnippet(0, () => true, beforeJS);
    f.requests.at(-1).complete([{id: "script", type: "js", enabled: true, content: "run();"},
        {...css, content: "body {color: blue;}"}]);
    assert.equal(f.elements.get("snippetCSSstyle").textContent, "body {color: blue;}");
    await withJS;
    assert.equal(dependencies, 1);
    assert.equal(f.executed.length, 0);
    f.config.snippet.enabledCSS = false;
    const disabled = f.exports.renderSnippet(0, () => true, beforeJS);
    f.requests.at(-1).complete([css]);
    await disabled;
    assert.equal(f.elements.size, 0);
    assert.equal(dependencies, 1);
});

test("JS waits for its dependency and respects disposal while the dependency is pending", async () => {
    const f = fixture();
    let ready: () => void;
    let active = true;
    const render = f.exports.renderSnippet(0, () => active, () => new Promise<void>(resolve => { ready = resolve; }));
    f.requests.at(-1).complete([{id: "script", type: "js", enabled: true, content: "run();"}]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.executed.length, 0);
    active = false;
    ready();
    await render;
    assert.equal(f.executed.length, 0);
});
