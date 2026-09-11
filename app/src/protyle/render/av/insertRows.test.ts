import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/protyle/render/av/row.ts", "utf8");
const compiled = transpileModule(source.slice(source.indexOf("export const insertRows ="),
    source.indexOf("export const duplicateRows =")), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

for (const viewType of ["table", "gallery", "kanban"]) {
    for (const count of [1, 3]) {
        test(`${viewType}: undo and redo ${count} added entries using their item IDs`, () => {
            let nextID = 0;
            let operations: any[];
            let inverse: any[];
            const exports: any = {};
            const blockElement = {
                dataset: {nodeId: "database-block"},
                getAttribute: (name: string) => ({
                    "data-av-id": "database",
                    "data-av-type": viewType,
                    "custom-av-view": "view",
                    updated: "20260911000000",
                })[name],
                setAttribute: () => {},
            };
            runInNewContext(compiled, {
                exports,
                Lute: {NewNodeID: () => `generated-${++nextID}`},
                dayjs: () => ({format: () => "20260911010000"}),
                Constants: {CUSTOM_SY_AV_VIEW: "custom-av-view"},
                getAVFilteredTipContext: () => ({}),
                transaction: (_protyle: any, doOperations: any[], undoOperations: any[]) => {
                    operations = doOperations;
                    inverse = undoOperations;
                },
                insertGalleryItemAnimation: () => {},
                insertAttrViewBlockAnimation: () => {},
            });
            exports.insertRows({blockElement, protyle: {}, count, previousID: "previous", groupID: "group"});
            const rows = new Set(["existing"]);
            const apply = (items: any[]) => items.forEach(operation => {
                if (operation.action === "insertAttrViewBlock") {
                    operation.srcs.forEach((src: any) => rows.add(src.itemID));
                } else if (operation.action === "removeAttrViewBlock") {
                    operation.srcIDs.forEach((id: string) => rows.delete(id));
                }
            });
            for (let cycle = 0; cycle < 2; cycle++) {
                apply(operations);
                assert.equal(rows.size, count + 1);
                apply(inverse);
                assert.deepEqual([...rows], ["existing"]);
            }
            assert.equal(operations[0].previousID, "previous");
            assert.equal(operations[0].groupID, "group");
        });
    }
}
