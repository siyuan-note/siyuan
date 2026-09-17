import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/protyle/render/av/col.ts", "utf8");
const compiled = transpileModule(source.slice(source.indexOf("const removeColByMenu ="),
    source.indexOf("const genUpdateColItem =")).replace("const removeColByMenu =", "export const removeColByMenu ="), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

for (const entry of ["removeColByMenu", "removeCol"]) {
    test(`${entry} preserves the database carrier and field identity for undo`, () => {
        let operations: any[];
        let inverse: any[];
        const exports: any = {};
        runInNewContext(compiled, {
            exports,
            dayjs: () => ({format: () => "20260916120000"}),
            transaction: (_protyle: any, doOperations: any[], undoOperations: any[]) => {
                operations = JSON.parse(JSON.stringify(doOperations));
                inverse = JSON.parse(JSON.stringify(undoOperations));
            },
            removeAttrViewColAnimation: () => {},
        });
        exports[entry]({
            protyle: {}, colId: "field", avID: "database", blockID: "carrier", oldValue: "Field",
            type: "date", removeDest: true, isTwoWay: true, isCustomAttr: true,
            fields: [{id: "previous"}, {id: "field", name: "Field", type: "date", dateFormat: "full"}],
            cellElement: {dataset: {dateFormat: "full"}, previousElementSibling: {getAttribute: () => "previous"}},
            blockElement: {getAttribute: () => "20260916090000", setAttribute: () => {}},
            menuElement: {querySelector: () => ({getAttribute: () => "field"})},
            avPanelElement: {remove: () => {}},
        });
        assert.equal(operations[0].action, "removeAttrViewCol");
        assert.equal(inverse[0].action, "addAttrViewCol");
        for (const operation of [operations[0], inverse[0]]) {
            assert.equal(operation.id, "field");
            assert.equal(operation.avID, "database");
            assert.equal(operation.blockID, "carrier");
        }
        assert.equal(operations[0].removeDest, true);
        assert.equal(inverse[0].previousID, "previous");
    });
}
