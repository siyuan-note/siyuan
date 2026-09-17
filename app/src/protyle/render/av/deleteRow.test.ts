import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/protyle/render/av/row.ts", "utf8");
const compiled = transpileModule(source.slice(source.indexOf("export const deleteRow ="),
    source.indexOf("export const insertRows =")), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

for (const binding of ["omitted", "bound", "detached"]) {
    test(`delete row undo preserves the ${binding} binding source over JSON`, () => {
        const primaryValue = {
            ...(binding === "omitted" ? {} : {isDetached: binding === "detached"}),
            block: {id: binding === "detached" ? "" : "bound-block", content: "Primary"},
        };
        let operations: any[];
        let inverse: any[];
        const exports: any = {};
        const blockElement = {
            dataset: {nodeId: "database-block"},
            getAttribute: (name: string) => name === "data-av-id" ? "database" : "20260916090000",
            setAttribute: () => {},
            querySelectorAll: (): HTMLElement[] => [],
            querySelector: (): HTMLElement | null => null,
        };
        runInNewContext(compiled, {
            exports,
            getAVSelectedItemInfos: () => [{
                itemID: "original-item", previousID: "previous", groupID: "group",
                primaryCell: {value: primaryValue},
            }],
            Lute: {NewNodeID: () => "restored-item"},
            dayjs: () => ({format: () => "20260916100000"}),
            transaction: (_protyle: any, doOperations: any[], undoOperations: any[]) => {
                operations = JSON.parse(JSON.stringify(doOperations));
                inverse = JSON.parse(JSON.stringify(undoOperations));
            },
            clearSelect: () => {},
            stickyRow: () => {},
            updateHeader: () => {},
        });
        exports.deleteRow(blockElement, {});
        const restore = inverse.find(operation => operation.action === "insertAttrViewBlock");
        assert.equal(restore.srcs[0].isDetached, binding === "detached");
        assert.equal(restore.srcs[0].id, binding === "detached" ? "original-item" : "bound-block");
        assert.equal(restore.srcs[0].content, "Primary");
        assert.equal(restore.previousID, "previous");
        assert.equal(restore.groupID, "group");
        assert.equal(restore.srcs[0].itemID, "original-item");
        assert.deepEqual(operations[0].srcIDs, ["original-item"]);
        assert.equal(operations[0].blockID, "database-block");
    });
}
