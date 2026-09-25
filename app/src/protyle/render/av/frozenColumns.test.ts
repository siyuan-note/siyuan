import * as assert from "node:assert/strict";
import {test} from "node:test";
import {updateFrozenColumns} from "./frozenColumns";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("frozen columns adapt to available width without changing the saved boundary", () => {
    let viewportWidth = 352;
    let frozenWidth = 623;
    const groups = [true, false].map(hasFrozen => ({
        disabled: false,
        querySelector: () => hasFrozen ? {getBoundingClientRect: () => ({width: frozenWidth})} : null,
        classList: {toggle(name: string, value: boolean) {
            assert.equal(name, "av__body--unfreeze");
            groups[hasFrozen ? 0 : 1].disabled = value;
        }},
    }));
    const block = {
        dataset: {avType: "table"},
        querySelector: () => ({get clientWidth() {return viewportWidth;}}),
        querySelectorAll: () => groups,
    } as unknown as HTMLElement;
    updateFrozenColumns(block);
    assert.equal(groups[0].disabled, true);
    assert.equal(groups[1].disabled, false);
    viewportWidth = 703;
    updateFrozenColumns(block);
    assert.equal(groups[0].disabled, false);
    frozenWidth = 624;
    updateFrozenColumns(block);
    assert.equal(groups[0].disabled, true);
    frozenWidth = 200;
    updateFrozenColumns(block);
    assert.equal(groups[0].disabled, false);
    viewportWidth = 0;
    updateFrozenColumns(block);
    assert.equal(groups[0].disabled, false);
});

test("cell navigation reveals previously frozen cells when freezing is suspended", () => {
    const compiled = transpileModule(readFileSync("src/protyle/render/av/cell.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    let suspended = true;
    const scroll = {scrollLeft: 600, getBoundingClientRect: () => ({left: 16, right: 368})};
    const row = {
        parentElement: {classList: {contains: () => suspended}},
        querySelector: () => ({contains: () => true}),
    };
    const exports: {cellScrollIntoView?: (block: unknown, cell: unknown, onlyHeight: boolean) => void} = {};
    runInNewContext(compiled, {
        exports,
        require: () => ({hasClosestByClassName: (_element: unknown, name: string) => name === "av__row" ? row : null}),
    });
    const block = {querySelector: (name: string) => name === ".av__scroll" ? scroll : null};
    const cell = {getBoundingClientRect: () => ({left: -184, right: 16, width: 200})};
    exports.cellScrollIntoView(block, cell, false);
    assert.equal(scroll.scrollLeft, 400);
    suspended = false;
    exports.cellScrollIntoView(block, cell, false);
    assert.equal(scroll.scrollLeft, 400);
});
