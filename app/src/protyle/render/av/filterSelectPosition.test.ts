import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const position = (viewport: {innerWidth: number, innerHeight: number}, rect: {
    left: number, top: number, bottom: number, width: number
}, labelWidth: number, height: number) => {
    const methods = {} as typeof import("./selectPosition");
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/selectPosition.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports: methods, require: () => ({}), window: viewport});
    const style = {} as CSSStyleDeclaration;
    const dropdown = {
        style,
        querySelectorAll: () => [{scrollWidth: labelWidth}],
        get offsetHeight() { return Math.min(height, parseFloat(style.maxHeight) || height); },
    };
    methods.setFilterSelectPosition(dropdown as unknown as HTMLElement, {
        getBoundingClientRect: () => rect,
    } as HTMLElement);
    return {style, height: dropdown.offsetHeight};
};

test("long filter options expand independently of a narrow trigger and stay inside the right edge", () => {
    const {style, height} = position({innerWidth: 1920, innerHeight: 1080},
        {left: 1740, top: 340, bottom: 368, width: 80}, 400, 800);
    assert.equal(style.width, "464px");
    assert.equal(parseFloat(style.left) + parseFloat(style.width), 1912);
    assert.equal(height, 480);
    assert.equal(style.top, "372px");
    assert.equal(style.visibility, "");
});

test("filter options fit a narrow mobile viewport and open above a low trigger", () => {
    const {style, height} = position({innerWidth: 320, innerHeight: 640},
        {left: 250, top: 500, bottom: 528, width: 70}, 900, 800);
    assert.equal(style.width, "304px");
    assert.equal(style.left, "8px");
    assert.equal(height, 480);
    assert.equal(style.top, "16px");
});

test("short viewports constrain the list to the larger available side", () => {
    const {style, height} = position({innerWidth: 800, innerHeight: 300},
        {left: 20, top: 100, bottom: 128, width: 100}, 30, 800);
    assert.equal(style.width, "280px");
    assert.equal(height, 160);
    assert.equal(parseFloat(style.top) + height, 292);
});
