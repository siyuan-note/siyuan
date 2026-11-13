import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {transpileModule, ScriptTarget} from "typescript";

const source = readFileSync("src/layout/Wnd.ts", "utf8");
const method = source.indexOf("public switchTab(");
const start = source.indexOf("let currentTab: Tab;", method);
const end = source.indexOf("// 在 JSONToLayout 中进行 focus", start);
const code = transpileModule("(function(target) {" + source.slice(start, end) + "})", {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

for (const targetFirst of [true, false]) {
    test(`tablet switch saves source before target visibility changes, target first ${targetFirst}`, () => {
        class Editor {
            editor: {protyle: {name: string; top: number; block: {rootID: string}}};
            constructor(name: string, top: number) { this.editor = {protyle: {name, top, block: {rootID: name}}}; }
        }
        const saved: Array<[string, number]> = [];
        const history: Array<[string, number]> = [];
        const make = (name: string, hidden: boolean) => ({
            model: new Editor(name, name === "source" ? 994 : 0),
            headElement: {classList: {contains: () => false, add() {}, remove() {}},
                getAttribute: (): string | null => null, setAttribute() {}},
            panelElement: {classList: {
                contains: () => hidden,
                add: () => { hidden = true; },
                remove: () => { hidden = false; if (name === "target") old.model.editor.protyle.top = 1958; },
            }},
        });
        const old = make("source", false);
        const next = make("target", true);
        const unrelated = make("hidden", true);
        const fn = runInNewContext(code, {
            Editor, isPhablet: () => true,
            saveTabPosition: (p: {name: string; top: number}) => saved.push([p.name, p.top]),
            saveBackScroll: (p: {name: string; top: number}) => history.push([p.name, p.top]),
            restoreTabPosition() {}, fetchPost() {}, Date,
        });
        fn.call({children: targetFirst ? [next, old, unrelated] : [old, next, unrelated]}, next.headElement);
        assert.deepEqual(saved, [["source", 994]]);
        assert.deepEqual(history, [["source", 994]]);
    });
}
