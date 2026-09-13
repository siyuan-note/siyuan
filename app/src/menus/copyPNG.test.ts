import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/menus/util.ts", "utf8");
const compiled = transpileModule(source.substring(source.indexOf("export const copyPNGByLink =")), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

for (const scenario of [
    {type: "image/svg+xml", width: 1200, height: 600, ratio: 1, expected: [2400, 1200]},
    {type: "image/svg+xml", width: 1200, height: 600, ratio: 3, expected: [3600, 1800]},
    {type: "image/svg+xml", width: 4096, height: 4096, ratio: 2, expected: [4096, 4096]},
    {type: "image/jpeg", width: 1200, height: 600, ratio: 2, expected: [1200, 600]},
    {type: "image/png", width: 1200, height: 600, ratio: 2, expected: undefined},
]) {
    test(`copy PNG resolution: ${JSON.stringify(scenario)}`, async () => {
        const original = new Blob(["source"], {type: scenario.type});
        const png = new Blob(["rendered"], {type: "image/png"});
        const draws: unknown[][] = [];
        const copied: Blob[] = [];
        const canvas = {
            width: 0,
            height: 0,
            getContext: () => ({drawImage: (...args: unknown[]) => draws.push(args)}),
            toBlob: (callback: (blob: Blob) => void) => callback(png),
        };
        const exports = {} as {copyPNGByLink: (link: string) => void};
        runInNewContext(compiled, {
            exports,
            isInAndroid: () => false,
            showMessage: () => {},
            writePNGBlob: async (blob: Blob) => { copied.push(blob); return true; },
            window: {devicePixelRatio: scenario.ratio, siyuan: {languages: {}}},
            fetch: async () => ({ok: true, blob: async () => original}),
            URL: {createObjectURL: () => "blob:test", revokeObjectURL: () => {}},
            document: {
                createElement: (tag: string) => tag === "canvas" ? canvas : {
                    naturalWidth: scenario.width,
                    naturalHeight: scenario.height,
                    onload: () => {},
                    set src(value: string) { this.onload(); },
                },
            },
        });
        exports.copyPNGByLink("blob:diagram");
        await new Promise(resolve => setImmediate(resolve));
        if (scenario.expected) {
            assert.deepEqual([canvas.width, canvas.height], scenario.expected);
            assert.deepEqual(draws[0].slice(1), [0, 0, ...scenario.expected]);
            assert.deepEqual(copied, [png]);
        } else {
            assert.equal(draws.length, 0);
            assert.deepEqual(copied, [original]);
        }
    });
}
