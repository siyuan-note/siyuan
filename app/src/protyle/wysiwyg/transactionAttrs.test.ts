import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("transaction.ts", readFileSync("src/protyle/wysiwyg/transaction.ts", "utf8"),
    ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(source) === "syncBlockAttrs"));
const attribute = "custom-sy-list-mindmap";
const metadataAttribute = "custom-sy-list-mindmap-data";
const context = {Constants: {CUSTOM_SY_LIST_MINDMAP: attribute, CUSTOM_SY_LIST_MINDMAP_DATA: metadataAttribute},
    sync: undefined as any};
runInNewContext(transpileModule(declaration.getText(source) + "\nglobalThis.sync = syncBlockAttrs;", {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText, context);

test("mind map view transactions synchronize matching blocks when toggling, undoing and redoing", () => {
    const copies = [new Map<string, string>(), new Map<string, string>()];
    const root = {
        querySelectorAll(selector: string) {
            assert.equal(selector, '[data-node-id="list-id"]');
            return copies.map(attrs => ({
                setAttribute: (name: string, value: string) => attrs.set(name, value),
                removeAttribute: (name: string) => attrs.delete(name),
            }));
        },
    };
    for (const value of ["1", "", "1", ""]) {
        context.sync(root, {action: "setAttrs", id: "list-id", data: JSON.stringify({[attribute]: value})});
        copies.forEach(attrs => assert.equal(attrs.get(attribute), value || undefined));
    }
});

test("unrelated attribute transactions preserve the mind map view", () => {
    const attrs = new Map([[attribute, "1"]]);
    const root = {querySelectorAll: () => [{
        setAttribute: (name: string, value: string) => attrs.set(name, value),
        removeAttribute: (name: string) => attrs.delete(name),
    }]};
    context.sync(root, {action: "setAttrs", id: "list-id", data: JSON.stringify({style: "color: red", fold: "1"})});
    assert.equal(attrs.get(attribute), "1");
    assert.equal(attrs.get("style"), "color: red");
    assert.equal(attrs.get("fold"), "1");
});

test("kernel metadata cleanup and undo synchronize across editor copies", () => {
    const attrs = new Map<string, string>();
    const root = {querySelectorAll: () => [{
        setAttribute: (name: string, value: string) => attrs.set(name, value),
        removeAttribute: (name: string) => attrs.delete(name),
    }]};
    for (const value of ['{"version":1,"nodes":{},"relations":[]}', '{"version":1,"nodes":{"a":{}},"relations":[]}']) {
        context.sync(root, {action: "setAttrs", id: "list-id", data: JSON.stringify({[metadataAttribute]: value})});
        assert.equal(attrs.get(metadataAttribute), value);
    }
});
