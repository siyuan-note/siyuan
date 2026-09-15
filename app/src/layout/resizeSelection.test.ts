import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isIfStatement, Node, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("util.ts", readFileSync("src/layout/util.ts", "utf8"), ScriptTarget.ES2021, true);
let restoreSelection: string;
const visit = (node: Node) => {
    if (isIfStatement(node) && node.expression.getText(source) === "range" &&
        node.thenStatement.getText(source).includes("focusByRange(range)")) {
        restoreSelection = node.getText(source);
    }
    node.forEachChild(visit);
};
visit(source);
assert.ok(restoreSelection);
const compiled = transpileModule(restoreSelection, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const checkRestore = (startHidden: boolean, endHidden: boolean, textNode: boolean) => {
    const container = (hidden: boolean) => {
        const element = {
            nodeType: 1,
            closest(selector: string) {
                assert.equal(selector, '.tab-item[data-tabs-hidden="true"]');
                return hidden ? {} : null;
            },
        };
        return textNode ? {nodeType: 3, parentElement: element} : element;
    };
    const range = {startContainer: container(startHidden), endContainer: container(endHidden)};
    let restored = false;
    runInNewContext(compiled, {
        range, Node: {ELEMENT_NODE: 1},
        focusByRange(value: unknown) {
            assert.equal(value, range);
            restored = true;
        },
    });
    return restored;
};

test("resizing preserves the selected tab when the old selection is hidden", () => {
    for (const textNode of [false, true]) {
        assert.equal(checkRestore(true, true, textNode), false);
        assert.equal(checkRestore(true, false, textNode), false);
        assert.equal(checkRestore(false, true, textNode), false);
    }
});

test("resizing restores selections in visible content", () => {
    assert.equal(checkRestore(false, false, false), true);
    assert.equal(checkRestore(false, false, true), true);
});
