import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import type {DocTreeController} from "./DocTreeController";
import {refreshImportedDocTree} from "./importRefresh";

for (const [parentPath, parents] of [["/", [""]], ["/doc.sy", ["", "doc"]],
    ["/ancestor/parent/doc.sy", ["parent", "doc"]]] as const) {
    test(`import refresh scopes and orders directories for ${parentPath}`, async () => {
        const calls: unknown[] = [];
        let release: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        const tree = {reload: async (filter: unknown) => { calls.push(filter); await pending; }};
        const refreshing = refreshImportedDocTree(tree as DocTreeController, {notebook: "box", parentPath});
        assert.deepEqual(calls, [{notebook: "box", parentID: parents[0]}]);
        release();
        await refreshing;
        assert.deepEqual(calls, parents.map(parentID => ({notebook: "box", parentID})));
    });
}

for (const file of ["src/layout/dock/Files.ts", "src/mobile/dock/MobileFiles.ts"]) {
    test(`${file} refreshes imported directories and pinned documents`, () => {
        const source = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
        const method = source.statements.find(isClassDeclaration).members.find(member =>
            member.name?.getText(source) === "onDocsImported");
        const calls: unknown[] = [];
        const data = {notebook: "box", parentPath: "/parent/doc.sy", rootIDs: ["new"]};
        const tree = {};
        const compiled = transpileModule(`class Adapter {${method.getText(source)}} return Adapter;`, {
            compilerOptions: {target: ScriptTarget.ES2022},
        }).outputText;
        const Adapter = new Function("refreshImportedDocTree", compiled)((...args: unknown[]) => calls.push(args));
        const adapter = new Adapter();
        adapter.docTree = tree;
        adapter.pinnedDocs = {scheduleRefresh: () => calls.push("pinned")};
        adapter.onDocsImported(data);
        assert.deepEqual(calls, ["pinned", [tree, data]]);
    });
}
