import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as selection from "./selectionState";

const source = transpileModule(readFileSync("src/protyle/render/av/rangeSelect.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

const setup = () => {
    const columns = ["a", "b", "c"].map(id => ({id, type: "number"}));
    const rows = Array.from({length: 6}, (_, index) => ({id: `row-${index}`,
        cells: columns.map(column => ({id: `${index}-${column.id}`, value: {keyID: column.id, type: "number"}}))}));
    const data = {viewType: "table", view: {id: "view", columns, rows}} as IAV;
    const block = {dataset: {avType: "table"}, querySelectorAll: (): HTMLElement[] => []} as unknown as HTMLElement;
    const exports = {} as typeof import("./rangeSelect");
    runInNewContext(source, {exports, require: (name: string) => ({
        "./virtualScroll": {getAVData: () => data},
        "./selectionState": {...selection, restoreAVCellSelection: () => {}},
        "./row": {updateAVSelectionStatus: () => {}},
        "./viewType": {isTableLikeView: () => true},
        "../../util/hasClosest": {hasClosestByClassName: (element: Element, name: string) => element.closest("." + name)},
    }[name] || {})});
    const origin = [1, 2].flatMap(index => ["a", "b"].map(colID =>
        selection.resolveAVSelectedCell(data, {groupID: "", rowID: `row-${index}`, colID})));
    const target = (index: number, colID = "b", groupID = "") => {
        const body = {dataset: {groupId: groupID}};
        const row = {dataset: {id: `row-${index}`}, closest: () => body};
        return {dataset: {colId: colID}, closest: () => row} as unknown as HTMLElement;
    };
    return {data, block, origin, target, select: exports.selectAVDragFillRange};
};

for (const [targetIndex, expectedRows] of [[0, [0, 1, 2]], [5, [1, 2, 3, 4, 5]]] as const) {
    test(`drag-fill preview reaches row ${targetIndex} across unmounted rows and columns`, () => {
        const h = setup();
        assert.equal(h.select(h.block, h.origin, h.target(targetIndex)), true);
        assert.deepEqual(Array.from(selection.getAVSelectedCells(h.block), cell => `${cell.rowID}:${cell.colID}`),
            expectedRows.flatMap(index => [`row-${index}:a`, `row-${index}:b`]));
    });
}

test("drag-fill preview restores the original rectangle on an invalid column or source row", () => {
    const h = setup();
    assert.equal(h.select(h.block, h.origin, h.target(5)), true);
    assert.equal(h.select(h.block, h.origin, h.target(5, "c")), false);
    assert.equal(selection.getAVSelectedCells(h.block).length, 4);
    assert.equal(h.select(h.block, h.origin, h.target(2)), false);
    assert.equal(selection.getAVSelectedCells(h.block).length, 4);
    assert.equal(h.select(h.block, h.origin, h.target(5, "b", "other")), false);
    (h.data.view as IAVTable).rows.splice(1, 1);
    assert.equal(h.select(h.block, h.origin, h.target(5)), false);
});
