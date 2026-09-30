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
    const renders: Array<{theme: string, resolve: (value: {svg: string}) => void}> = [];
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
        require: () => ({
            Constants: {PROTYLE_CDN: "", ZWSP: ""}, addScript: async () => {},
            isFoldedRenderContent: () => false, isZenumlDiagram: () => false,
            getMermaidLayout: () => "", applyMermaidLayout: (value: string) => value,
            hasClosestByClassName: (): Element => null, getHostCapabilities: () => ({remoteKernel: false}),
        }),
        Lute: {NewNodeID: () => String(++counter), UnEscapeHTMLStr: (value: string) => value},
        window: {siyuan: {config}, DOMPurify: {sanitize: (value: string) => value}, mermaid: {
            registerIconPacks() {}, initialize: (value: {theme: string}) => { theme = value.theme; },
            render: () => new Promise(resolve => renders.push({theme, resolve})),
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
});
