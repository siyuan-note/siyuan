import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isPropertyAssignment, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
    ScriptTarget.ES2021, true);
const controller = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapController");
assert.ok(controller && isClassDeclaration(controller));
let callback = "";
const visit = (node: import("typescript").Node) => {
    if (isPropertyAssignment(node) && node.name.getText(source) === "onNodeWidths") {
        callback = node.initializer.getText(source);
    }
    node.forEachChild(visit);
};
visit(controller);
assert.ok(callback);
const methods = controller.members.filter(item => item.name && ["metadata", "change"].includes(item.name.getText(source)));
const compiled = transpileModule(`class Controller {
    ${methods.map(item => item.getText(source)).join("\n")}
    onNodeWidths = ${callback};
} globalThis.Controller = Controller;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

test("node width changes and mixed-width restoration save one undoable snapshot without replacing other styles", async () => {
    for (const version of [1, 2]) {
        let metadata: {version: number, nodes: Record<string, {width: number, textColor?: string}>,
            relations: unknown[], extension: string} = {
            version, nodes: {a: {width: 0, textColor: "red"}, b: {width: 480}}, relations: [], extension: "keep",
        };
        const list = {isConnected: true, dataset: {nodeId: "map"}, closest: (): null => null,
            get outerHTML() { return JSON.stringify(metadata); }};
        let editable = true;
        let messages = 0;
        const history: {before: string, after: string}[] = [];
        const context: any = {list, owner: {}, canEdit: () => editable,
            readListMindmap: () => ({root: {id: "root"}, metadata: structuredClone(metadata),
                nodes: new Map([["a", {children: []}], ["b", {children: []}]])}),
            getListMindmapSiblingIDs: () => new Map(),
            normalizeListMindmapSummaryMetadata: () => {}, cleanListMindmapHTML: (value: string) => value,
            writeListMindmapMetadata: (_list: unknown, value: typeof metadata) => metadata = value,
            updateTransaction: (_owner: unknown, _list: unknown, before: string) => history.push({before, after: list.outerHTML}),
            showMessage: () => messages++, window: {siyuan: {languages: {listMindmapStale: "stale"}}}};
        runInNewContext(compiled, context);
        const target = Object.assign(new context.Controller(), {list, owner: {}, view: {getSelectedId: () => "a"}, refresh: () => {}});
        const original = [{id: "a", width: 0}, {id: "b", width: 480}];
        const changed = [{id: "a", width: 320}, {id: "b", width: 320}];
        assert.equal(await target.onNodeWidths(changed, JSON.stringify(original)), true);
        assert.equal(history.length, 1);
        assert.equal(metadata.nodes.a.textColor, "red");
        assert.equal(metadata.extension, "keep");
        assert.equal(await target.onNodeWidths(original, JSON.stringify(changed)), true);
        assert.equal(history.length, 2, "restoring different original widths is one change");
        assert.equal(history[1].after, history[0].before, "restoration retains automatic width and all unrelated metadata");
        assert.equal(await target.onNodeWidths(changed, JSON.stringify(changed)), false, "a stale snapshot cannot overwrite newer widths");
        for (const widths of [[{id: "missing", width: 200}], [{id: "a", width: -1}], [{id: "a", width: NaN}]]) {
            const expected = JSON.stringify(widths.map(({id}) => ({id, width: metadata.nodes[id]?.width || 0})));
            assert.equal(await target.onNodeWidths(widths, expected), false);
        }
        assert.equal(messages, 4);
        editable = false;
        assert.equal(await target.onNodeWidths(changed, JSON.stringify(original)), false);
        assert.equal(history.length, 2);
    }
});
