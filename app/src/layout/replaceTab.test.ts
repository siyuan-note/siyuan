import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("preview replacement removes the old tab before enforcing the tab limit", async () => {
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
    for (const replace of ["immediate", "pending", "failed", "none"] as const) {
        const wnd = Object.create(exports.Wnd.prototype);
        wnd.children = [tab("unrelated"), tab("old-preview")];
        wnd.headersElement = {parentElement: node, childElementCount: 2, children: [node, node]};
        wnd.element = {querySelector: () => ({...node, children: [node, node, node]})};
        wnd.parent = {type: "center"};
        let limited = false;
        wnd.removeOverCounter = () => { limited = true; };
        let finish: () => void;
        wnd.removeTab = (id: string) => {
            const remove = () => {
                wnd.children = wnd.children.filter((item: {id: string}) => item.id !== id);
                return true;
            };
            if (replace === "pending" || replace === "failed") {
                return new Promise<boolean>(resolve => {
                    finish = () => resolve(replace === "pending" ? remove() : false);
                });
            }
            return remove();
        };
        wnd.addTab(tab("new-preview"), false, false, undefined, replace !== "none" ? "old-preview" : undefined);
        assert.equal(limited, replace === "none", "pending replacement must not evict an unrelated tab early");
        if (finish) {
            finish();
            await new Promise<void>(resolve => setImmediate(resolve));
            assert.equal(limited, true, "recheck the current count after replacement settles");
        }
        assert.equal(wnd.children.some((item: {id: string}) => item.id === "unrelated"), true);
        assert.equal(wnd.children.some((item: {id: string}) => item.id === "old-preview"), replace === "none" || replace === "failed");
        assert.equal(wnd.children.some((item: {id: string}) => item.id === "new-preview"), true);
    }
});
