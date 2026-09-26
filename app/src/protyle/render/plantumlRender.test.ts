import * as assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/plantumlRender.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

for (const mode of ["editor", "readonly", "preview", "export", "remote"]) {
    test(`PlantUML ${mode} preserves rendering and only exposes interactive preview controls`, async () => {
        let button: {disabled: boolean};
        let buttonCount = 0;
        let rendered: {tag: string; src?: string; data?: string};
        let onObjectError: () => void;
        const classes = new Set(["protyle-icons"]);
        const renderElement = {
            classList: {remove: () => {}, add: () => {}},
            replaceChildren: (element: typeof rendered) => { rendered = element; },
        };
        const icons = {
            classList: {contains: (name: string) => classes.has(name), add: (name: string) => classes.add(name)},
            querySelector: () => button,
            insertAdjacentHTML: () => { button = {disabled: false}; buttonCount++; },
            nextElementSibling: renderElement,
        };
        const attributes = new Map([["data-subtype", "plantuml"], ["data-content", "Alice -> Bob"]]);
        const block = {
            firstElementChild: icons,
            getAttribute: (name: string) => attributes.get(name),
            setAttribute: (name: string, value: string) => attributes.set(name, value),
        };
        const exports = {} as {plantumlRender: (element: unknown) => void};
        runInNewContext(compiled, {
            exports,
            require: () => ({
                Constants: {PROTYLE_CDN: ""},
                addScript: async () => {},
                hasClosestByClassName: () => mode === "preview" ? false : {hasAttribute: () => mode !== "export"},
                getHostCapabilities: () => ({remoteKernel: mode === "remote"}),
            }),
            Lute: {UnEscapeHTMLStr: (value: string) => value},
            window: {siyuan: {languages: {preview: "Preview"}, config: {editor: {plantUMLServePath: "https://example.com/svg/"}}},
                plantumlEncoder: {encode: () => "encoded"}},
            document: {createElement: (tag: string) => ({tag, addEventListener: (_name: string, callback: () => void) => { onObjectError = callback; }})},
        });
        exports.plantumlRender(block);
        await Promise.resolve();
        assert.equal(rendered.tag, mode === "remote" ? "img" : "object");
        assert.equal(rendered.src || rendered.data, "https://example.com/svg/encoded");
        assert.equal(buttonCount, mode === "export" ? 0 : 1);
        if (mode !== "remote") {
            onObjectError();
            assert.equal(rendered.tag, "img");
            assert.equal(rendered.src, "https://example.com/svg/encoded");
        }
        attributes.delete("data-render");
        attributes.set("data-content", "");
        exports.plantumlRender(block);
        await Promise.resolve();
        assert.equal(buttonCount, mode === "export" ? 0 : 1);
        if (button) {
            assert.equal(button.disabled, true);
        }
    });
}
