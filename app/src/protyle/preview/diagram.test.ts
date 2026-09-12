import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/preview/diagram.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

for (const scenario of [
    {viewBox: {width: 2400, height: 1200}, expected: [2400, 1200]},
    {viewBox: {width: 300, height: 150}, expected: [600, 300]},
    {viewBox: {width: 0, height: 0}, expected: [600, 300]},
]) {
    test(`diagram preview preserves intrinsic dimensions: ${JSON.stringify(scenario.viewBox)}`, async () => {
        const attributes = new Map<string, string>();
        const clone = {
            style: {} as Record<string, string>,
            querySelectorAll: (): Element[] => [],
            setAttribute: (name: string, value: string) => attributes.set(name, value),
        };
        const svg = {
            viewBox: {baseVal: scenario.viewBox},
            cloneNode: () => clone,
            querySelectorAll: (): Element[] => [],
            getBoundingClientRect: () => ({width: 600, height: 300}),
        };
        let previewBlob: Blob;
        let cleanup: () => void;
        const revoked: string[] = [];
        const exports = {} as {previewDiagram: (element: unknown) => Promise<void>};
        runInNewContext(compiled, {
            exports,
            require: () => ({
                Constants: {PROTYLE_CDN: ""},
                addScript: async () => {},
                previewImages: (urls: string[], current: string, onHidden: () => void) => { cleanup = onHidden; },
            }),
            window: {getComputedStyle: () => ({length: 0})},
            Blob,
            XMLSerializer: class { public serializeToString() { return "<svg/>"; } },
            URL: {
                createObjectURL: (blob: Blob) => { previewBlob = blob; return "blob:diagram"; },
                revokeObjectURL: (url: string) => revoked.push(url),
            },
        });
        await exports.previewDiagram({getAttribute: () => "mermaid", querySelector: () => svg});
        assert.deepEqual([Number(attributes.get("width")), Number(attributes.get("height"))], scenario.expected);
        assert.equal(clone.style.width, `${scenario.expected[0]}px`);
        assert.equal(clone.style.height, `${scenario.expected[1]}px`);
        assert.equal(previewBlob.type, "image/svg+xml");
        cleanup();
        assert.deepEqual(revoked, ["blob:diagram"]);
    });
}
