import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isPropertyAssignment, Node, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("tabs.ts", readFileSync("src/protyle/wysiwyg/tabs.ts", "utf8"), ScriptTarget.ES2021, true);
let activate: string;
const visit = (node: Node) => {
    if (isPropertyAssignment(node) && node.name.getText(source) === "activate") {
        activate = node.initializer.getText(source);
    }
    node.forEachChild(visit);
};
visit(source);
assert.ok(activate);
const compiled = transpileModule(`(${activate})(item);`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const fixture = (editable: boolean, hasText = true) => {
    const hidden = {hidden: true, getClientRects: () => [1]};
    const title = {hidden: false, getClientRects: (): number[] => []};
    const visible = {hidden: false, getClientRects: () => [1]};
    const content = {querySelectorAll: () => hasText ? [hidden, title, visible] : []};
    const oldRange = {};
    const protyle = {toolbar: {range: oldRange}};
    let selected: unknown;
    let focused: unknown;
    let collapsed: boolean;
    const savedRange = {};
    const range = {
        selectNodeContents(target: unknown) { selected = target; },
        collapse(value: boolean) { collapsed = value; },
        cloneRange: () => savedRange,
    };
    runInNewContext(compiled, {
        item: {}, protyle, canEdit: () => editable,
        getTabContent: () => content,
        isHiddenTabContent: (element: typeof hidden) => element.hidden,
        document: {createRange: () => range},
        hideElements: () => {},
        focusByRange(value: unknown) { focused = value; },
    });
    return {selected, focused, collapsed, range, protyle, oldRange, savedRange, visible, content};
};

test("tab activation moves the cursor and saved selection to visible content", () => {
    const f = fixture(true);
    assert.equal(f.selected, f.visible);
    assert.equal(f.focused, f.range);
    assert.equal(f.collapsed, true);
    assert.equal(f.protyle.toolbar.range, f.savedRange);
});

test("tab activation uses the panel when no editable text is available", () => {
    const f = fixture(true, false);
    assert.equal(f.selected, f.content);
    assert.equal(f.focused, f.range);
});

test("readonly tab activation preserves the selection", () => {
    const f = fixture(false);
    assert.equal(f.focused, undefined);
    assert.equal(f.protyle.toolbar.range, f.oldRange);
});
