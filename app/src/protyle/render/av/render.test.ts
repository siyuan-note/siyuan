import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {clampGroupTableVirtualData} from "./groupTableVirtual";
import {isAVCellPanelForBlock, setAVCellPanelTarget} from "./panelTarget";
import {getAVCellSelection, refreshAVCellSelection, setAVCellSelection} from "./selectionState";

const source = ts.createSourceFile("render.ts", readFileSync(join(__dirname, "render.ts"), "utf8"),
    ts.ScriptTarget.ES2022, true);
const statement = source.statements.find(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(declaration => declaration.name.getText(source) === "getTableHTMLs"));
assert.ok(statement);
const compiled = ts.transpileModule(statement.getText(source), {
    compilerOptions: {target: ts.ScriptTarget.ES2022},
}).outputText;

const setup = (avType: "table" | "list") => {
    const mounted: number[] = [];
    const attributes = new Map<string, string>();
    const render = runInNewContext(compiled + "\ngetTableHTMLs;", {
        clampGroupTableVirtualData,
        getRowHTML: ({rowIndex}: {rowIndex: number}) => { mounted.push(rowIndex); return "<div></div>"; },
        Constants: {ATTRIBUTE_V_SCROLL: "data-v-scroll"},
        window: {siyuan: {languages: {}}},
    }) as (data: IAVTable, element: HTMLElement, virtualData?: IAVVirtualData) => string;
    const block = {dataset: {avType}, setAttribute: (name: string, value: string) => attributes.set(name, value)};
    return {
        mounted, attributes,
        render: (count: number, pageSize: number, virtualData?: IAVVirtualData) => {
            mounted.length = 0;
            return render({columns: [], rows: Array.from({length: count}, (_, id) => ({id: String(id)})),
                rowCount: 500, pageSize} as IAVTable, block as unknown as HTMLElement, virtualData);
        },
    };
};

for (const avType of ["table", "list"] as const) {
    test(`${avType} cumulative loading bounds mounted rows independently of the page step`, () => {
        for (const pageSize of [50, 100, 200]) {
            for (const count of [0, 50, 100, 101, 167, 500]) {
                const h = setup(avType);
                const html = h.render(count, pageSize);
                assert.equal(h.mounted.length, Math.min(count, 100), `${pageSize}/${count}`);
                assert.equal(h.attributes.has("data-v-scroll"), count > 100, `${pageSize}/${count}`);
                assert.match(html, new RegExp(`data-size="${pageSize}"`));
            }
        }
    });

    test(`${avType} shrinking results restores visible rows instead of retaining an out-of-range window`, () => {
        const h = setup(avType);
        const restored = {renderedStart: 90, renderedEnd: 99, topSpacerHeight: 3240};
        const html = h.render(3, 200, restored);
        assert.deepEqual(h.mounted, [0, 1, 2]);
        assert.doesNotMatch(html, /av__spacer/);
        assert.deepEqual(restored, {renderedStart: 90, renderedEnd: 99, topSpacerHeight: 3240});
        assert.doesNotMatch(h.render(0, 200, restored), /av__spacer/);
        assert.deepEqual(h.mounted, []);
    });

    test(`${avType} refresh retains a valid deep window and clips its end to the remaining results`, () => {
        const h = setup(avType);
        const restored = {renderedStart: 90, renderedEnd: 99, topSpacerHeight: 3240};
        assert.match(h.render(167, 100, restored), /height: 3240px/);
        assert.deepEqual(h.mounted, Array.from({length: 10}, (_, id) => 90 + id));
        h.render(95, 100, restored);
        assert.deepEqual(h.mounted, [90, 91, 92, 93, 94]);
    });

    test(`${avType} located windows retain their absolute row indexes`, () => {
        const h = setup(avType);
        const html = h.render(167, 100, {renderedStart: 10, renderedEnd: 19,
            topSpacerHeight: 360, rowOffset: 400, locate: true});
        assert.deepEqual(h.mounted, Array.from({length: 10}, (_, id) => 410 + id));
        assert.match(html, /height: 360px/);
    });
}

const afterRenderSource = source.statements.find(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(declaration => declaration.name.getText(source) === "afterRenderTable"));
assert.ok(afterRenderSource);
const afterRenderCompiled = ts.transpileModule(afterRenderSource.getText(source), {
    compilerOptions: {target: ts.ScriptTarget.ES2022},
}).outputText;

const setupPanelRefresh = (rows: string[], owner: "current" | "other" | "config" = "current", selectedRows = ["edited"]) => {
    const markedCells: string[] = [];
    const cell = {classList: {add: (name: string) => markedCells.push(name)}};
    const scroll = {scrollLeft: 0};
    const block = {
        style: {},
        getAttribute: (): null => null,
        setAttribute() {},
        querySelector: (selector: string) => selector === ".av__scroll" ? scroll :
            selector.includes('[data-id="edited"]') && rows.includes("edited") ? cell : null,
    } as unknown as HTMLElement;
    let removed = false;
    const panel = {remove: () => { removed = true; }} as unknown as Element;
    if (owner !== "config") {
        setAVCellPanelTarget(panel, owner === "current" ? block : {} as Element);
    }
    const column = {id: "platform", type: "mSelect"} as IAVColumn;
    const point = {groupID: "", rowID: "edited", colID: column.id};
    setAVCellSelection(block, {
        anchor: point,
        focus: point,
        cells: selectedRows.map(rowID => ({...point, rowID, rowIndex: 0, colIndex: 0, column, cell: {} as IAVCell})),
    });
    const resetData = {
        left: 0, alignSelf: "", selectCellId: {groupId: "", rowId: "edited", colId: column.id},
        dragFillId: {groupId: "", rowId: "edited", colId: column.id},
        activeIds: [{groupId: "", rowId: "edited", colId: column.id}],
        selectRowIds: [] as {groupId: string, rowId: string}[], pageSizes: {}, isSearching: false,
    };
    const data = {view: {id: "view", columns: [column], rows: rows.map(id => ({id, cells: [{}]}))}} as unknown as IAV;
    const noop = () => {};
    const render = runInNewContext(afterRenderCompiled + "\nafterRenderTable", {
        refreshAVCellSelection, isAVCellPanelForBlock,
        document: {querySelector: (selector: string) => selector === ".av__panel" && !removed ? panel : null},
        getSelection: () => ({rangeCount: 0}),
        getPendingBlockFocusMode: noop,
        updateFrozenColumns: noop, setAVData: noop, renderAVRichTextElements: noop,
        addDragFill: noop, cellScrollIntoView: noop, restoreAVCellSelection: noop,
        initVirtualScroll: noop, updateAVSelectionStatus: noop, finishAVLocate: noop,
        Constants: {CB_GET_HISTORY: "history"},
    });
    return {
        block, resetData, markedCells, removed: () => removed,
        render: () => render({blockElement: block, data, resetData, renderAll: false,
            protyle: {options: {action: ["history"]}, contentElement: {getBoundingClientRect: (): null => null}}}),
    };
};

test("filtering out the edited database row closes its panel when the cell selection becomes invalid", () => {
    const h = setupPanelRefresh([]);
    h.render();
    assert.equal(h.removed(), true);
    assert.equal(getAVCellSelection(h.block), undefined);
    assert.equal(h.resetData.selectCellId, undefined);
    assert.equal(h.resetData.dragFillId, undefined);
    assert.equal(h.resetData.activeIds.length, 0);
});

test("a database refresh keeps the panel open while its selected cells remain in the result", () => {
    const h = setupPanelRefresh(["edited"]);
    h.render();
    assert.equal(h.removed(), false);
    assert.equal(getAVCellSelection(h.block)?.cells.length, 1);
    assert.ok(h.markedCells.includes("av__cell--select"));
});

test("filtering out part of a batch selection closes the panel and clears the invalid range", () => {
    const h = setupPanelRefresh(["edited"], "current", ["edited", "filtered"]);
    h.render();
    assert.equal(h.removed(), true);
    assert.equal(getAVCellSelection(h.block), undefined);
    assert.deepEqual(h.markedCells, []);
});

for (const owner of ["other", "config"] as const) {
    test(`filtering a row preserves a panel belonging to ${owner === "other" ? "another display instance" : "view configuration"}`, () => {
        const h = setupPanelRefresh([], owner);
        h.render();
        assert.equal(h.removed(), false);
        assert.equal(getAVCellSelection(h.block), undefined);
    });
}
