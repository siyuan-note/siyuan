import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
    ScriptTarget.ES2021, true);
const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => ["canToggleView", "canEdit", "toggleListMindmap"].includes(item.name.getText(source))));
const compiled = transpileModule(declarations.map(item => item.getText(source).replace(/^export /, "")).join("\n") +
    "\nglobalThis.api = {canEdit, toggleListMindmap};", {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const setup = () => {
    const root = {};
    const embed = {};
    const owner = {disabled: false, lite: false, options: {action: [] as string[]}, wysiwyg: {element: root}};
    const attribute = "custom-sy-list-mindmap";
    const attrs = new Map([[attribute, "1"]]);
    const list = {
        isConnected: true,
        dataset: {type: "NodeList", nodeId: "source-list"},
        closest: (selector: string) => selector === ".protyle-wysiwyg" ? root : embed,
        getAttribute: (name: string) => attrs.get(name),
        setAttribute: (name: string, value: string) => attrs.set(name, value),
    };
    const operations: {doOperations: any[], undoOperations: any[]}[] = [];
    const context: any = {
        Constants: {CB_GET_HISTORY: "history", CUSTOM_SY_LIST_MINDMAP: attribute},
        roots: new WeakMap(), hideElements: () => {}, readListMindmap: () => {},
        transaction: (actualOwner: unknown, doOperations: any[], undoOperations: any[]) => {
            assert.equal(actualOwner, owner);
            operations.push({doOperations, undoOperations});
        },
    };
    runInNewContext(compiled, context);
    return {owner, list, attrs, attribute, operations, api: context.api};
};

test("embedded mind maps persist view changes against the source list with undo", () => {
    const {owner, list, attrs, attribute, operations, api} = setup();
    assert.equal(api.canEdit(owner, list), false, "embedded node content remains read-only");
    for (const next of ["", "1"]) {
        const previous = attrs.get(attribute);
        api.toggleListMindmap(owner, list);
        const operation = operations[operations.length - 1];
        assert.equal(operation.doOperations[0].action, "setAttrs");
        assert.equal(operation.doOperations[0].id, "source-list");
        assert.deepEqual(JSON.parse(operation.doOperations[0].data), {[attribute]: next});
        assert.deepEqual(JSON.parse(operation.undoOperations[0].data), {[attribute]: previous});
        assert.equal(attrs.get(attribute), next);
    }
    assert.equal(operations.length, 2);
});

test("read-only, history and lightweight editors cannot persist embedded view changes", () => {
    for (const mode of ["disabled", "lite", "history"]) {
        const {owner, list, operations, api} = setup();
        if (mode === "history") {
            owner.options.action.push("history");
        } else {
            owner[mode as "disabled" | "lite"] = true;
        }
        api.toggleListMindmap(owner, list);
        assert.equal(operations.length, 0);
    }
});

test("removed lists and blocks without IDs cannot submit view changes", () => {
    for (const removed of [false, true]) {
        const {list, owner, api, operations} = setup();
        if (removed) {
            list.isConnected = false;
        } else {
            list.dataset.nodeId = "";
        }
        api.toggleListMindmap(owner, list);
        assert.equal(operations.length, 0);
    }
});
