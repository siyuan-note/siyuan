import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("panel binding searches the primary text and anchors to the original field", () => {
    const requests: unknown[][] = [];
    let selected: HTMLElement;
    const range = {selectNodeContents: (element: HTMLElement) => { selected = element; }};
    const protyle = {options: {}, toolbar: {}} as IProtyle;
    const field = {isConnected: true, dataset: {rowId: "item"},
        querySelector: () => ({value: "  Current title  "})} as unknown as HTMLElement;
    const exports = {} as typeof import("./bindBlock");
    runInNewContext(transpileModule(readFileSync(join(__dirname, "bindBlock.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {
        exports,
        require: () => ({hintRef: (...args: unknown[]) => requests.push(args)}),
        document: {createRange: () => range},
        window: {siyuan: {menus: {menu: {remove() {}}}}},
    });
    exports.openAVBindBlock(protyle, field);
    assert.equal(selected, field);
    assert.equal(protyle.toolbar.range, range);
    assert.deepEqual(requests, [["Current title", protyle, "av"]]);
    exports.openAVBindBlock(protyle, field, "Hidden primary");
    assert.deepEqual(requests[1], ["Hidden primary", protyle, "av"]);
    protyle.disabled = true;
    exports.openAVBindBlock(protyle, field);
    protyle.disabled = false;
    protyle.options.history = {snapshot: "snapshot"} as IProtyle["options"]["history"];
    exports.openAVBindBlock(protyle, field);
    assert.equal(requests.length, 2);
});
