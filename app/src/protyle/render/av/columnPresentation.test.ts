import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {insertAVTableColumn, removeAVTableColumn, updateAVTableColumnPresentation, updateAVTableShowIcon} from "./columnPresentation";
import {getTablePinIndex} from "./groupTableVirtual";

const code = transpileModule(readFileSync("src/protyle/render/av/render.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

for (const action of ["setAttrViewColWrap", "setAttrViewWrapField"] as const) {
    test(`${action} updates unmounted rows and folded groups before invalidating measured heights`, () => {
        const table = (): IAVTable => ({columns: [{id: "text", wrap: false}, {id: "other", wrap: false}], rows: []}) as IAVTable;
        const view = table();
        view.groups = [table(), {...table(), groupFolded: true}];
        let wrap = "false";
        let invalidated = 0;
        const cell = {setAttribute: (_key: string, value: string) => { wrap = value; }};
        const block = {closest: (): null => null, getAttribute: () => "view", querySelectorAll: () => [cell]};
        const exports = {} as typeof import("./render");
        runInNewContext(code, {exports, require: (name: string) => ({
            "./virtualScroll": {
                getAVData: () => ({viewType: "table", view}),
                invalidateAVTableRowHeights: () => {
                    invalidated++;
                    assert.equal(view.columns[0].wrap, true);
                    assert.equal(wrap, "true");
                },
            },
            "./viewType": {isTableLikeView: () => true},
            "./columnPresentation": {updateAVTableColumnPresentation},
            "./columnWindow": {prepareAVColumnWindow: () => {}},
            "../../../constants": {Constants: {}},
        }[name] || {})});
        exports.refreshAV({wysiwyg: {element: {querySelectorAll: () => [block]}}} as unknown as IProtyle,
            {action, avID: "database", viewID: "view", id: "text", data: true});
        for (const item of [view, ...view.groups as IAVTable[]]) {
            assert.equal(item.columns[0].wrap, true);
            assert.equal(item.columns[1].wrap, action === "setAttrViewWrapField");
        }
        assert.equal(invalidated, 1);
    });
}

test("alignment and block icons stay in the model for newly mounted rows and folded groups", () => {
    const table = (): IAVTable => ({columns: [{id: "title", align: "left"}, {id: "other", align: "left"}],
        rows: [], showIcon: true}) as IAVTable;
    const view = table();
    view.groups = [table(), {...table(), groupFolded: true}];
    const classList = {toggle: (_name: string, hidden: boolean) => {
        assert.equal(hidden, true);
    }};
    const cell = {dataset: {align: "left"}, classList, firstElementChild: {classList}};
    const block = {closest: (): null => null, getAttribute: () => "view", querySelectorAll: () => [cell]};
    const exports = {} as typeof import("./render");
    runInNewContext(code, {exports, require: (name: string) => ({
        "./virtualScroll": {getAVData: () => ({viewType: "table", view})},
        "./viewType": {isTableLikeView: () => true},
        "./columnPresentation": {updateAVTableColumnPresentation, updateAVTableShowIcon},
        "./columnWindow": {prepareAVColumnWindow() {}},
        "../../../constants": {Constants: {}},
    }[name] || {})});
    const protyle = {wysiwyg: {element: {querySelectorAll: () => [block]}}} as unknown as IProtyle;
    exports.refreshAV(protyle, {action: "setAttrViewColAlign", avID: "database", viewID: "view", id: "title", data: "right"});
    exports.refreshAV(protyle, {action: "setAttrViewShowIcon", avID: "database", viewID: "view", data: false});
    for (const item of [view, ...view.groups as IAVTable[]]) {
        assert.equal(item.columns[0].align, "right");
        assert.equal(item.columns[1].align, "left");
        assert.equal(item.showIcon, false);
    }
    assert.equal(cell.dataset.align, "right");
});

test("column insert and removal preserve cell alignment in shared and folded group snapshots", () => {
    const columns = ["a", "b", "c"].map(id => ({id, type: "text", pin: id === "b"})) as IAVColumn[];
    const cell = (id: string): IAVCell => ({id: `value-${id}`, valueType: "text", color: "", bgColor: "",
        value: {type: "text", keyID: id, text: {content: id}}});
    const rows = [{id: "row", cells: columns.map(column => cell(column.id))}];
    const view = {columns, rows, rowCount: rows.length,
        groups: [{columns, rows, rowCount: rows.length},
            {columns, rows, rowCount: rows.length, groupFolded: true}] as IAVTable[],
    } as IAVTable;
    insertAVTableColumn(view, {id: "new", type: "text"} as IAVColumn, "a", () => cell("new"));
    for (const table of [view, ...view.groups as IAVTable[]]) {
        assert.deepEqual(table.columns.map(column => column.id), ["a", "new", "b", "c"]);
        assert.deepEqual(table.rows[0].cells.map(value => value.value.keyID), ["a", "new", "b", "c"]);
        assert.equal(getTablePinIndex(table), 2);
    }
    assert.equal(columns.length, 3, "the previous metadata array remains available to undo callers");
    assert.equal(rows[0].cells.length, 3, "shared original rows are not mutated twice");
    view.columns = view.columns.filter(column => column.id !== "b");
    removeAVTableColumn(view, "b");
    removeAVTableColumn(view, "b");
    for (const table of [view, ...view.groups as IAVTable[]]) {
        assert.deepEqual(table.columns.map(column => column.id), ["a", "new", "c"]);
        assert.deepEqual(table.rows[0].cells.map(value => value.value.keyID), ["a", "new", "c"]);
        assert.equal(getTablePinIndex(table), -1);
    }
});

test("column animation fills missing cells when a menu already inserted metadata", () => {
    const view = {columns: [{id: "a"}, {id: "new"}, {id: "b"}], rows: [{id: "row", cells: [
        {value: {keyID: "a"}}, {value: {keyID: "b"}},
    ]}]} as IAVTable;
    const create = () => ({value: {keyID: "new"}}) as IAVCell;
    insertAVTableColumn(view, {id: "new"} as IAVColumn, "a", create);
    insertAVTableColumn(view, {id: "new"} as IAVColumn, "a", create);
    assert.deepEqual(view.columns.map(column => column.id), ["a", "new", "b"]);
    assert.deepEqual(view.rows[0].cells.map(value => value.value.keyID), ["a", "new", "b"]);
});
