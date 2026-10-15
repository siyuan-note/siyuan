import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("preview replacement removes the old tab before enforcing the tab limit", () => {
    const exports = {} as {Wnd: {prototype: object}};
    runInNewContext(transpileModule(readFileSync("src/layout/Wnd.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, window: {siyuan: {config: {fileTree: {maxOpenTabCount: 2}}}}, require: (name: string) => {
        if (name === "../protyle/util/compatibility") { return {isPhablet: () => false}; }
        if (name === "../window/setHeader") { return {setModelsHash() {}}; }
        return {};
    }});
    const node = {
        classList: {contains: () => false, add() {}, remove() {}},
        querySelector: (): unknown => node,
        after() {}, append() {}, addEventListener() {}, setAttribute() {},
    };
    const tab = (id: string) => ({id, headElement: {...node, nextElementSibling: null as HTMLElement}, panelElement: node});
    for (const replace of [true, false]) {
        const wnd = Object.create(exports.Wnd.prototype);
        wnd.children = [tab("unrelated"), tab("old-preview")];
        wnd.headersElement = {parentElement: node, childElementCount: 2, children: [node, node]};
        wnd.element = {querySelector: () => ({...node, children: [node, node, node]})};
        wnd.parent = {type: "center"};
        let limited = false;
        wnd.removeOverCounter = () => { limited = true; };
        wnd.removeTab = (id: string) => {
            wnd.children = wnd.children.filter((item: {id: string}) => item.id !== id);
        };
        wnd.addTab(tab("new-preview"), false, false, undefined, replace ? "old-preview" : undefined);
        assert.equal(limited, !replace);
        assert.equal(wnd.children.some((item: {id: string}) => item.id === "unrelated"), true);
        assert.equal(wnd.children.some((item: {id: string}) => item.id === "old-preview"), !replace);
        assert.equal(wnd.children.some((item: {id: string}) => item.id === "new-preview"), true);
    }
});
