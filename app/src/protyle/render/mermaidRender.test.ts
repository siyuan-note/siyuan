import * as assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/mermaidRender.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("Mermaid follows both theme directions and discards renders superseded by a theme change", async () => {
    const attributes = new Map([["data-subtype", "mermaid"], ["data-content", "graph TD; A-->B"]]);
    const renders: Array<{theme: string, resolve: (value: {svg: string}) => void, reject: (reason: unknown) => void}> = [];
    const temporaryContainers: Array<{
        style: {cssText: string}, attached: boolean, removed: boolean,
        querySelector: (selector: string) => {outerHTML: string}, remove: () => void,
    }> = [];
    let theme = "";
    let counter = 0;
    const container = {
        lastElementChild: undefined as {innerHTML?: string},
        set innerHTML(_value: string) { this.lastElementChild = {}; },
    };
    const block = {
        firstElementChild: {clientWidth: 100, classList: {contains: () => true}, nextElementSibling: container},
        getAttribute: (name: string) => attributes.get(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
        querySelectorAll: (): Element[] => [],
        matches: () => true,
    };
    const config = {appearance: {mode: 0}};
    const api = {} as {mermaidRender: (element: unknown) => void, refreshMermaidTheme: (element: unknown) => void};
    runInNewContext(compiled, {
        exports: api,
        document: {
            body: {clientWidth: 1000, appendChild: (element: typeof temporaryContainers[number]) => {
                element.attached = true;
            }},
            createElement: (tag: string) => {
                assert.equal(tag, "div");
                const element = {
                    style: {cssText: ""}, attached: false, removed: false,
                    querySelector: (selector: string) => {
                        assert.equal(selector, "#mermaid" + (temporaryContainers.indexOf(element) + 1));
                        assert.equal(element.removed, false);
                        return {outerHTML: "error diagram"};
                    },
                    remove() { this.removed = true; },
                };
                temporaryContainers.push(element);
                return element;
            },
        },
        require: () => ({
            Constants: {PROTYLE_CDN: "", ZWSP: ""}, addScript: async () => {},
            isFoldedRenderContent: () => false, isZenumlDiagram: () => false,
            getMermaidLayout: () => "", applyMermaidLayout: (value: string) => value,
            hasClosestByClassName: (): Element => null, getHostCapabilities: () => ({remoteKernel: false}),
            escapeHtml: (value: string) => value,
        }),
        Lute: {NewNodeID: () => String(++counter), UnEscapeHTMLStr: (value: string) => value},
        window: {siyuan: {config}, DOMPurify: {sanitize: (value: string) => value}, mermaid: {
            registerIconPacks() {}, initialize: (value: {theme: string, look: string, layout: string}) => {
                assert.equal(value.look, undefined);
                assert.equal(value.layout, undefined);
                theme = value.theme;
            },
            render: (_id: string, _content: string, element: typeof temporaryContainers[number]) => {
                assert.equal(element, temporaryContainers[renders.length]);
                assert.equal(element.attached, true);
                assert.match(element.style.cssText, /position: fixed/);
                assert.match(element.style.cssText, /left: -100000px/);
                assert.match(element.style.cssText, /width: 1000px/);
                assert.doesNotMatch(element.style.cssText, /display:\s*none/);
                return new Promise((resolve, reject) => renders.push({theme, resolve, reject}));
            },
        }},
    });
    const flush = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); } };
    api.mermaidRender(block);
    await flush();
    assert.equal(renders[0].theme, "default");
    config.appearance.mode = 1;
    api.refreshMermaidTheme(block);
    await flush();
    assert.equal(renders[1].theme, "dark");
    renders[1].resolve({svg: "dark diagram"});
    await flush();
    assert.equal(container.lastElementChild.innerHTML, "dark diagram");
    renders[0].resolve({svg: "stale light diagram"});
    await flush();
    assert.equal(container.lastElementChild.innerHTML, "dark diagram");
    config.appearance.mode = 0;
    api.refreshMermaidTheme(block);
    await flush();
    assert.equal(renders[2].theme, "default");
    renders[2].resolve({svg: "light diagram"});
    await flush();
    assert.equal(container.lastElementChild.innerHTML, "light diagram");
    const body = {getAttribute: (): string => null, matches: () => false, querySelectorAll: () => [block]};
    config.appearance.mode = 1;
    api.refreshMermaidTheme(body);
    await flush();
    assert.equal(renders[3].theme, "dark");
    renders[3].resolve({svg: "dark body diagram"});
    await flush();
    assert.equal(container.lastElementChild.innerHTML, "dark body diagram");
    assert.ok(temporaryContainers.every(element => element.removed));
    api.refreshMermaidTheme(block);
    await flush();
    renders[4].reject("render failed");
    await flush();
    assert.match(container.lastElementChild.innerHTML, /error diagram/);
    assert.match(container.lastElementChild.innerHTML, /render failed/);
    assert.equal(temporaryContainers[4].removed, true);
    api.refreshMermaidTheme(block);
    await flush();
    api.refreshMermaidTheme(block);
    await flush();
    renders[6].resolve({svg: "latest diagram"});
    await flush();
    renders[5].reject("stale error");
    await flush();
    assert.equal(container.lastElementChild.innerHTML, "latest diagram");
    assert.ok(temporaryContainers.every(element => element.removed));
});
