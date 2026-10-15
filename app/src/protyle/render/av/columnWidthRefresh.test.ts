import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {updateAVTableColumnWidths} from "./columnWidth";

const code = transpileModule(readFileSync("src/protyle/render/av/render.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = (rendered: boolean) => {
    const createTable = (id: string, folded = false): IAVTable => ({
        id, columns: [{id: "title", width: "200px"}, {id: "status", width: "120px"}] as IAVColumn[],
        rows: [], rowCount: 0, groupFolded: folded,
    });
    const view = createTable("view");
    view.groups = [createTable("visible"), createTable("folded", true)];
    const otherView = createTable("other");
    const cells = [{style: {width: "64px"}}, {style: {width: "200px"}}];
    const blocks = [view, otherView].map((table, index) => ({
        closest: (): null => null,
        getAttribute: () => table.id,
        querySelector: () => rendered ? cells[index] : null,
        querySelectorAll: () => rendered ? [{querySelector: (selector: string) =>
            selector.includes("title") ? cells[index] : null}] : [],
    }));
    let frozenUpdates = 0;
    const exports: {refreshAV?: (protyle: unknown, operation: unknown) => void} = {};
    const dependencies: Record<string, unknown> = {
        "./virtualScroll": {getAVData: (block: unknown) => ({
            viewType: "table", view: block === blocks[0] ? view : otherView,
        })},
        "./viewType": {isTableLikeView: (type: string) => ["table", "list"].includes(type)},
        "./columnWidth": {updateAVTableColumnWidths},
        "./frozenColumns": {updateFrozenColumns: () => frozenUpdates++},
        "../../../constants": {Constants: {}},
    };
    runInNewContext(code, {exports, require: (name: string) => dependencies[name] || {}});
    const protyle = {wysiwyg: {element: {querySelectorAll: () => blocks}}};
    return {view, otherView, cells, frozenUpdates: () => frozenUpdates,
        refresh: (operation: object) => exports.refreshAV(protyle, {avID: "database", viewID: "view", ...operation})};
};

for (const rendered of [true, false]) {
    test(`single-column resizing updates folded group and virtual row data (${rendered ? "rendered" : "unrendered"})`, () => {
        const scenario = setup(rendered);
        scenario.refresh({action: "setAttrViewColWidth", id: "title", data: "64px"});
        for (const table of [scenario.view, ...scenario.view.groups as IAVTable[]]) {
            assert.equal(table.columns[0].width, "64px");
            assert.equal(table.columns[1].width, "120px");
        }
        assert.equal(scenario.view.groups[1].groupFolded, true);
        assert.equal(scenario.otherView.columns[0].width, "200px");
        assert.equal(scenario.frozenUpdates(), 1);
        if (rendered) {
            assert.equal(scenario.cells[0].style.width, "64px");
            assert.equal(scenario.cells[1].style.width, "200px");
        }
        scenario.refresh({action: "setAttrViewColWidth", id: "title", data: "200px"});
        assert.equal((scenario.view.groups[1] as IAVTable).columns[0].width, "200px");
    });
}

test("batch column resizing, undo and redo preserve widths in folded group data", () => {
    const scenario = setup(false);
    for (const widths of [{title: "80px", status: "80px"}, {title: "200px", status: "120px"},
        {title: "80px", status: "80px"}]) {
        scenario.refresh({action: "setAttrViewColsWidth", data: widths});
        for (const table of [scenario.view, ...scenario.view.groups as IAVTable[]]) {
            assert.deepEqual(table.columns.map(column => column.width), [widths.title, widths.status]);
        }
        assert.deepEqual(scenario.otherView.columns.map(column => column.width), ["200px", "120px"]);
    }
});
