import {getDocTreeItem, setDocTreeRowItem} from "../layout/dock/docTree/rowData";
import type {IDocTreeItem} from "../layout/dock/docTree/types";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {getDocTreeActionItems} from "../menus/navigationSelection";

const source = createSourceFile("deleteFile.ts", readFileSync("src/editor/deleteFile.ts", "utf8"), ScriptTarget.Latest, true);
const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => ["deleteFiles", "deleteDocTreeItems"].includes(item.name.getText(source))));
const compiled = transpileModule(declarations.map(declaration => declaration.getText(source)).join("\n"), {
    compilerOptions: {target: ScriptTarget.ES2022, module: 1},
}).outputText;

test("deleting repeated virtual occurrences removes one logical document without DOM", async () => {
    const removed: string[][] = [];
    const exported: {deleteDocTreeItems?: (items: unknown[]) => Promise<void>} = {};
    runInNewContext(compiled, {exports: exported, getDocTreeActionItems, getDocTreeItem,
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
    runInNewContext(compiled, {exports: exported, getDocTreeActionItems, getDocTreeItem,
        deleteFile: (notebook: string, path: string) => removed.push([notebook, path])});
    const row = {closest: () => row} as unknown as HTMLElement;
    setDocTreeRowItem(row, {id: "doc", notebookId: "box", path: "/doc.sy", kind: "document"} as IDocTreeItem);
    await exported.deleteFiles([row]);
    assert.deepEqual(removed, [["box", "/doc.sy"]]);
});
