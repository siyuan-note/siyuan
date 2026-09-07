import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/av/row.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("backlink scrolling clears fixed rows and their spacers without calculating window positions", () => {
    const exports: {stickyRow?: (block: unknown, scroll: unknown, status: string) => void} = {};
    runInNewContext(compiled, {exports, require: () => ({})});
    const makeRow = (fixedClass: string, placeholderClass: string) => {
        const classes = new Set([fixedClass]);
        const placeholder = {
            removed: false,
            classList: {contains: (name: string) => name === placeholderClass},
            remove() { this.removed = true; },
        };
        return {
            classList: {contains: (name: string) => classes.has(name), remove: (name: string) => classes.delete(name)},
            style: {top: "120px", bottom: "10px", left: "30px", width: "400px", transform: "translateX(-100px)", clipPath: "inset(0 50px 0 0)"},
            nextElementSibling: placeholder,
        };
    };
    const views = makeRow("av__views--fixed", "av__views-placeholder");
    const header = makeRow("av__row--header--fixed", "av__row--header-placeholder");
    const footer = makeRow("av__row--footer--fixed", "av__row--footer--placeholder");
    const block = {
        classList: {contains: (name: string) => name === "av--backlink"},
        querySelector: () => views,
        querySelectorAll: (selector: string) => selector.includes("header") ? [header] : [footer],
        getBoundingClientRect: () => { throw new Error("Backlink fixed layout must not read window coordinates"); },
    };
    const outer = {scrollTop: 250};
    for (let i = 0; i < 4; i++) {
        exports.stickyRow(block, outer, "all");
    }
    [views, header, footer].forEach(row => {
        assert.equal(row.nextElementSibling.removed, true);
        assert.deepEqual(Object.values(row.style), ["", "", "", "", "", ""]);
    });
    assert.equal(outer.scrollTop, 250);
});
