import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {isHandlerIALAttribute} from "../util/ialAttributes";

const source = createSourceFile("transaction.ts", readFileSync("src/protyle/wysiwyg/transaction.ts", "utf8"),
    ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(source) === "syncBlockAttrs"));
const attribute = "custom-sy-list-mindmap";
const metadataAttribute = "custom-sy-list-mindmap-data";
const viewportHeight = "custom-sy-table-viewport-height";
const context = {Constants: {CUSTOM_SY_LIST_MINDMAP: attribute, CUSTOM_SY_LIST_MINDMAP_DATA: metadataAttribute,
    CUSTOM_SY_TABLE_VIEWPORT_HEIGHT: viewportHeight},
    sync: undefined as any};
runInNewContext(transpileModule(declaration.getText(source) + "\nglobalThis.sync = syncBlockAttrs;", {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText, context);

const applyDeclaration = source.statements.find(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(source) === "applyBlockAttributes"));
const applyContext = {isHandlerIALAttribute, apply: undefined as any};
runInNewContext(transpileModule(applyDeclaration.getText(source) + "\nglobalThis.apply = applyBlockAttributes;", {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText, applyContext);

test("document tag transactions refresh header chips for deletion, undo and redo", () => {
    const rendered: string[] = [];
    const protyle = {block: {rootID: "document"}, background: {ial: {tags: "idea"},
        render: (ial: {tags: string}, id: string) => { assert.equal(id, "document"); rendered.push(ial.tags); }}};
    for (const tags of ["", "idea", ""]) {
        context.sync({}, {action: "setAttrs", id: "document", data: JSON.stringify({tags})}, protyle);
    }
    context.sync({}, {action: "setAttrs", id: "other-document", data: '{"tags":"other"}'}, protyle);
    assert.deepEqual(rendered, ["", "idea", ""]);
});

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

test("table viewport resize, undo and redo synchronize without replacing content", () => {
    const copies = [new Map([["custom-pinthead", "true"]]), new Map([["custom-pinthead", "true"]])];
    const root = {querySelectorAll: (selector: string) => {
        assert.equal(selector, '[data-node-id="table-id"]');
        return copies.map(attrs => ({
            setAttribute: (name: string, value: string) => attrs.set(name, value),
            removeAttribute: (name: string) => attrs.delete(name),
        }));
    }};
    for (const height of ["240px", "", "240px", "160px"]) {
        context.sync(root, {action: "setAttrs", id: "table-id", data: JSON.stringify({[viewportHeight]: height})});
        for (const attrs of copies) {
            assert.equal(attrs.get(viewportHeight), height || undefined);
            assert.equal(attrs.get("custom-pinthead"), "true");
        }
    }
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

test("updateAttrs never applies handler-named attributes", () => {
    const attrs = new Map<string, string>();
    const element = {setAttribute: (name: string, value: string) => { attrs.set(name, value); }};
    applyContext.apply(element, {
        new: {bookmark: "b", "custom-foo": "c", onmouseover: "window.xssFired=true", OnClick: "x"},
    });
    assert.deepEqual([...attrs.entries()], [["bookmark", "b"], ["custom-foo", "c"]]);
});
