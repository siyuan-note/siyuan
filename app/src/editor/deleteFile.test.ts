import {getDocTreeItem, setDocTreeRowItem} from "../layout/dock/docTree/rowData";
import type {IDocTreeItem} from "../layout/dock/docTree/types";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {getDocTreeDeleteItems} from "../menus/navigationSelection";

const source = createSourceFile("deleteFile.ts", readFileSync("src/editor/deleteFile.ts", "utf8"), ScriptTarget.Latest, true);
const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => ["deleteFiles", "deleteDocTreeItems"].includes(item.name.getText(source))));
const compiled = transpileModule(declarations.map(declaration => declaration.getText(source)).join("\n"), {
    compilerOptions: {target: ScriptTarget.ES2022, module: 1},
}).outputText;

test("deleting repeated virtual occurrences removes one logical document without DOM", async () => {
    const removed: string[][] = [];
    const exported: {deleteDocTreeItems?: (items: unknown[]) => Promise<void>} = {};
    runInNewContext(compiled, {exports: exported, getDocTreeDeleteItems, getDocTreeItem,
        deleteFile: (notebook: string, path: string) => removed.push([notebook, path])});
    await exported.deleteDocTreeItems([
        {id: "doc", notebookId: "box", path: "/doc.sy", kind: "document", name: "Document"},
        {id: "doc", notebookId: "box", path: "/doc.sy", kind: "document", name: "Document"},
    ]);
    assert.deepEqual(removed, [["box", "/doc.sy"]]);
});

test("deleteFiles resolves a detached row through its model", async () => {
    const removed: string[][] = [];
    const exported: {deleteFiles?: (items: unknown[]) => Promise<void>} = {};
    runInNewContext(compiled, {exports: exported, getDocTreeDeleteItems, getDocTreeItem,
        deleteFile: (notebook: string, path: string) => removed.push([notebook, path])});
    const row = {closest: () => row} as unknown as HTMLElement;
    setDocTreeRowItem(row, {id: "doc", notebookId: "box", path: "/doc.sy", kind: "document"} as IDocTreeItem);
    await exported.deleteFiles([row]);
    assert.deepEqual(removed, [["box", "/doc.sy"]]);
});

test("mixed deletion never directly deletes an uncovered notebook document", async () => {
    const exported: {deleteDocTreeItems?: (items: unknown[]) => Promise<void>} = {};
    runInNewContext(compiled, {exports: exported, getDocTreeDeleteItems, getDocTreeItem,
        deleteFile: () => { throw new Error("Notebook documents cannot be deleted directly"); }});
    await exported.deleteDocTreeItems([
        {id: "box", notebookId: "box", path: "/box.sy", kind: "document", name: "Notebook document"},
    ]);
});

test("a selected notebook covers its notebook document and children before reference checks", async () => {
    const requests: unknown[] = [];
    const exported: {deleteDocTreeItems?: (items: unknown[]) => Promise<void>} = {};
    runInNewContext(compiled, {exports: exported, getDocTreeDeleteItems, getDocTreeItem,
        Constants: {HELP_PATH: {help: "box"}},
        fetchPost: (url: string, data: unknown) => requests.push({url, data}),
        deleteFile: () => { throw new Error("Covered documents cannot be deleted separately"); }});
    await exported.deleteDocTreeItems([
        {id: "box", notebookId: "box", path: "/box.sy", kind: "document", name: "Notebook document"},
        {id: "child", notebookId: "box", path: "/child.sy", kind: "document", name: "Child"},
        {id: "box", notebookId: "box", path: "/", kind: "notebook", name: "Notebook"},
    ]);
    assert.equal(JSON.stringify(requests), '[{"url":"/api/notebook/removeNotebook","data":{"notebook":"box"}}]');
});
