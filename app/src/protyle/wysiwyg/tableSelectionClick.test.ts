import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isExpressionStatement, Node as TSNode, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("index.ts", readFileSync(join(__dirname, "index.ts"), "utf8"), ScriptTarget.Latest);
const loops: string[] = [];
const findLoop = (node: TSNode) => {
    if (isExpressionStatement(node) &&
        node.getText(source).startsWith('this.element.querySelectorAll(".table").forEach(')) {
        loops.push(node.getText(source));
    }
    forEachChild(node, findLoop);
};
findLoop(source);
assert.equal(loops.length, 1);
const compiled = transpileModule(`function click() {${loops[0]}}`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const table = (hasSelection = true, tagName = "DIV") => {
    const attributes = new Map([["style", "width: 100px; height: 30px;"]]);
    const selection = hasSelection ? {
        removeAttribute: (name: string) => attributes.delete(name),
        getAttribute: (name: string) => attributes.get(name) ?? null,
    } : null;
    return {tagName, attributes, querySelector: (selector: string) => {
        assert.equal(selector, ".table__select");
        return selection;
    }};
};

const click = (tables: ReturnType<typeof table>[], active?: ReturnType<typeof table>) => {
    let stopped = false;
    let continued = false;
    const context: any = {
        tableElement: active,
        event: {stopPropagation: () => { stopped = true; }},
    };
    runInNewContext(compiled, context);
    context.click.call({element: {querySelectorAll: (selector: string) => {
        assert.equal(selector, ".table");
        return tables;
    }}});
    continued = true;
    return {stopped, continued};
};

test("outside clicks skip preview tables without selection controls and clear all editable table selections", () => {
    const first = table();
    const second = table();
    const result = click([table(false), first, table(false), second]);
    assert.equal(first.attributes.has("style"), false);
    assert.equal(second.attributes.has("style"), false);
    assert.deepEqual(result, {stopped: false, continued: true});
});

test("clicking a preview table without selection controls continues without blocking editor events", () => {
    const preview = table(false);
    const editable = table();
    const result = click([preview, editable], preview);
    assert.equal(editable.attributes.has("style"), false);
    assert.deepEqual(result, {stopped: false, continued: true});
});

test("clicking the selected table preserves its selection and prevents the merged-cell menu from closing", () => {
    const active = table();
    const other = table();
    const result = click([other, table(false), active], active);
    assert.equal(active.attributes.has("style"), true);
    assert.equal(other.attributes.has("style"), false);
    assert.deepEqual(result, {stopped: true, continued: true});
    active.attributes.clear();
    assert.equal(click([active], active).stopped, false, "unselected tables do not stop propagation");
});

test("non-block elements with the table class remain outside table selection cleanup", () => {
    const nonBlock = table(true, "SPAN");
    assert.deepEqual(click([nonBlock]), {stopped: false, continued: true});
    assert.equal(nonBlock.attributes.has("style"), true);
});
