import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {restoreTabPosition, saveTabPosition} from "../protyle/scroll/tabPosition";

const source = createSourceFile("backForward.ts", readFileSync("src/util/backForward.ts", "utf8"), ScriptTarget.ES2021, true);
const names = ["readingPositions", "saveBackScroll", "focusStack"];
const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => names.includes(item.name.getText(source))));
const compiled = transpileModule(declarations.map(item => item.getText(source).replace(/^export /, "")).join("\n") +
    "\nglobalThis.save = saveBackScroll; globalThis.restore = focusStack;", {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

test("tab visibility changes preserve a scrolled viewport including zero", () => {
    const protyle = {contentElement: {scrollTop: 1133}} as IProtyle;
    saveTabPosition(protyle);
    protyle.contentElement.scrollTop = 0;
    restoreTabPosition(protyle);
    assert.equal(protyle.contentElement.scrollTop, 1133);
    protyle.contentElement.scrollTop = 0;
    saveTabPosition(protyle);
    protyle.contentElement.scrollTop = 200;
    restoreTabPosition(protyle);
    assert.equal(protyle.contentElement.scrollTop, 0);
});

for (const changedRange of [false, true]) {
    test(`tablet history restores reading position with ${changedRange ? "reloaded" : "retained"} blocks`, async () => {
        let visible = true;
        let switched = 0;
        let reloaded = 0;
        const protyle = {
            element: {getBoundingClientRect: () => ({height: visible ? 700 : 0})},
            contentElement: {scrollTop: 1133},
            block: {rootID: "doc"},
            wysiwyg: {element: {
                firstElementChild: {getAttribute: () => changedRange ? "changed" : "first"},
                lastElementChild: {getAttribute: () => "last"},
            }},
            model: {parent: {headElement: {}, parent: {switchTab: () => { switched++; visible = true; }}}},
        };
        const stack = {id: "old-caret", protyle};
        const context: any = {
            previousIsBack: false,
            forwardStack: [],
            window: {siyuan: {backStack: [stack]}},
            isPhablet: () => true,
            saveScroll: () => ({rootId: "doc", startId: "first", endId: "last", scrollTop: protyle.contentElement.scrollTop}),
            document: {contains: () => true},
            hideElements: () => {},
            getDocByScroll: (options: any) => {
                reloaded++;
                assert.equal(options.focus, false);
                assert.equal(options.scrollAttr.startId, "first");
                protyle.contentElement.scrollTop = options.scrollAttr.scrollTop;
                options.cb();
            },
        };
        runInNewContext(compiled, context);
        context.save(protyle);
        visible = false;
        protyle.contentElement.scrollTop = 0;
        context.save(protyle);
        assert.equal(await context.restore({}, stack), true);
        assert.equal(protyle.contentElement.scrollTop, 1133);
        assert.equal(switched, 1);
        assert.equal(reloaded, changedRange ? 1 : 0);
    });
}
