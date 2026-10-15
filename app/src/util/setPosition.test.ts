import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("sticky menus retain their anchor while staying inside a resized viewport", () => {
    const methods = {} as typeof import("./setPosition");
    const viewport = {innerWidth: 1000, innerHeight: 800};
    runInNewContext(transpileModule(readFileSync("src/util/setPosition.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: methods,
        require: () => ({getTopBarHeight: () => 30}),
        window: viewport,
    });
    let height = 400;
    const element = {
        style: {left: "0px", top: "0px"},
        dataset: {} as Record<string, string>,
        getBoundingClientRect() {
            const top = parseFloat(this.style.top);
            const left = parseFloat(this.style.left);
            return {top, left, right: left + 300, bottom: top + height, width: 300, height};
        },
    };
    const position = () => methods.setPosition(element as unknown as HTMLElement, 650, 750, 30, 0, true);
    position();
    assert.equal(element.style.top, "320px");
    height = 500;
    position();
    assert.equal(element.style.top, "220px");
    assert.equal(element.style.left, "650px");
    viewport.innerWidth = 360;
    viewport.innerHeight = 640;
    position();
    assert.equal(element.style.top, "140px");
    assert.equal(element.style.left, "60px");
    assert.equal(element.dataset.positionBottom, "640");
    height = 620;
    position();
    assert.equal(element.style.top, "30px");
});
