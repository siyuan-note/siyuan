import * as assert from "node:assert/strict";
import {test} from "node:test";
import {loadModule} from "../../../testSupport/loadModule";
import {DOMFixture} from "./testDOM";
import {IAVCellPoint, resolveAVSelectedCell} from "./selectionState";
import * as capabilities from "./capabilities";

const fixture = () => {
    const dom = new DOMFixture();
    dom.body.innerHTML = `<div class="protyle"><div class="av" data-av-id="database" data-av-type="table">
<div class="av__body" data-group-id="group"><div class="av__row" data-id="first"><div class="av__cell" data-col-id="column" data-dtype="text"></div></div>
<div class="av__row" data-id="second"><div class="av__cell" data-col-id="column" data-dtype="text"></div></div></div></div></div>`;
    const owner = dom.body.firstElementChild;
    const block = owner.firstElementChild;
    const group = block.firstElementChild;
    const first = group.firstElementChild.firstElementChild;
    const second = group.lastElementChild.firstElementChild;
    const opened: unknown[] = [];
    const selected: unknown[] = [];
    const config = {readonly: false};
    const protyle = {element: owner, wysiwyg: {element: owner}, disabled: false, options: {}};
    const data = {viewID: "view"};
    const column = {hidden: false, type: "text"};
    let removed = false;
    let next = group.lastElementChild;
    const document = {body: dom.body, activeElement: dom.body, querySelector: (): unknown => null};
    const methods = loadModule<typeof import("./continuousInput")>("src/protyle/render/av/continuousInput.ts", {
        window: {siyuan: {config}}, document,
        require: (name: string) => ({
            "./capabilities": capabilities,
            "./viewType": {isTableLikeView: (type: string) => type === "table" || type === "list"},
            "./virtualScroll": {getAVData: () => data, ensureAVTableAdjacentRow: () => next, ensureAVTableRow() {}},
            "./columnWindow": {ensureAVColumnWindow() {}},
            "./selectionState": {getAVCellSelection: (): undefined => undefined,
                resolveAVSelectedCell: (_data: unknown, point: {rowID: string}) =>
                !removed && point.rowID === "second" ? {column} : undefined},
            "./rangeSelect": {setAVCellAnchor: (_block: unknown, cell: unknown) => {selected.push(cell); return true;}},
        })[name],
    });
    const prepare = (cells = [first]) => methods.prepareAVContinuousInput(protyle as unknown as IProtyle,
        block as unknown as HTMLElement, cells as unknown as HTMLElement[], cell => opened.push(cell));
    return {dom, block, group, first, second, opened, selected, config, protyle, data, column, document, methods, prepare,
        removeTarget: () => {removed = true;}, end: () => {next = null;}};
};

test("continuous input follows the captured row and column after redraw rather than a changed neighbor", () => {
    for (const type of ["table", "list"]) {
        const f = fixture();
        f.block.dataset.avType = type;
        const proceed = f.prepare();
        f.group.innerHTML = `<div class="av__row" data-id="another"><div class="av__cell" data-col-id="column" data-dtype="text"></div></div>
<div class="av__row" data-id="second"><div class="av__cell" data-col-id="column" data-dtype="text"></div></div>`;
        proceed();
        assert.equal(f.opened[0], f.group.lastElementChild.firstElementChild);
        assert.deepEqual(f.selected, f.opened);
    }
});

test("continuous input excludes batch, details, readonly, bound primary fields and non-table views", () => {
    for (const state of ["batch", "readonly", "disabled", "gallery", "details", "boundPrimary"]) {
        const f = fixture();
        if (state === "readonly") f.config.readonly = true;
        if (state === "disabled") f.protyle.disabled = true;
        if (state === "gallery") f.block.dataset.avType = "gallery";
        if (state === "details") f.block.classList.add("custom-attr");
        if (state === "boundPrimary") f.first.dataset.dtype = "block";
        assert.equal(f.prepare(state === "batch" ? [f.first, f.second] : [f.first]), undefined, state);
    }
});

test("last-row confirmation stops without creating a row or moving to another group", () => {
    const f = fixture();
    f.end();
    const proceed = f.prepare();
    assert.equal(typeof proceed, "function");
    proceed();
    assert.deepEqual(f.opened, []);
});

test("delayed confirmation cannot move into a deleted, hidden, changed or disconnected target", () => {
    for (const state of ["removed", "hidden", "type", "view", "locked", "closed", "otherFocus", "otherEditor"]) {
        const f = fixture();
        const proceed = f.prepare();
        if (state === "removed") f.removeTarget();
        if (state === "hidden") f.column.hidden = true;
        if (state === "type") f.column.type = "number";
        if (state === "view") f.data.viewID = "another-view";
        if (state === "locked") f.config.readonly = true;
        if (state === "closed") f.block.remove();
        if (state === "otherFocus") f.document.activeElement = f.dom.createElement("input");
        if (state === "otherEditor") f.document.querySelector = () => ({});
        proceed();
        assert.deepEqual(f.opened, [], state);
    }
});

test("continuous confirmation leaves composition, modified Enter and held keys to their existing handlers", () => {
    const {methods} = fixture();
    const event = {key: "Enter", isComposing: false, repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false};
    assert.equal(methods.isAVContinuousInputKey(event as KeyboardEvent), true);
    assert.equal(methods.isAVContinuousInputKey({...event, keyCode: 229} as KeyboardEvent), false);
    for (const key of ["isComposing", "repeat", "shiftKey", "ctrlKey", "metaKey", "altKey"]) {
        assert.equal(methods.isAVContinuousInputKey({...event, [key]: true} as KeyboardEvent), false, key);
    }
});

const rangeFixture = (types: TAVCol[] = ["number", "text", "url"], rowCount = 2) => {
    const dom = new DOMFixture();
    dom.body.innerHTML = '<div class="protyle"><div class="av" data-av-id="database" data-av-type="table"><div class="av__body" data-group-id="group"></div></div></div>';
    const owner = dom.body.firstElementChild;
    const block = owner.firstElementChild;
    const group = block.firstElementChild;
    const columns = types.map((type, index) => ({id: "col" + index, type, hidden: false} as IAVColumn));
    const rows = Array.from({length: rowCount}, (_, index) => ({id: "row" + index,
        cells: columns.map(column => ({value: {type: column.type, isDetached: true} as IAVCellValue}))}));
    const data = {viewID: "view", view: {id: "group", columns, rows}} as unknown as IAV;
    const points = rows.flatMap(row => columns.map(column => ({groupID: "group", rowID: row.id, colID: column.id})));
    let selection: ReturnType<typeof import("./selectionState").getAVCellSelection> = {
        anchor: points.at(-1), focus: points[0], cells: points.map(point => resolveAVSelectedCell(data, point)),
    };
    const redraw = () => {
        group.innerHTML = rows.map(row => `<div class="av__row" data-id="${row.id}">${columns.map(column =>
            `<div class="av__cell" data-col-id="${column.id}" data-dtype="${column.type}" data-detached="true"></div>`).join("")}</div>`).join("");
    };
    redraw();
    const opened: IAVCellPoint[] = [];
    const rendered: string[] = [];
    const config = {readonly: false};
    const document = {body: dom.body, activeElement: dom.body, querySelector: (): unknown => null};
    const protyle = {element: owner, wysiwyg: {element: owner}, options: {}, disabled: false};
    const methods = loadModule<typeof import("./continuousInput")>("src/protyle/render/av/continuousInput.ts", {
        window: {siyuan: {config}}, document,
        require: (name: string) => ({
            "./capabilities": capabilities,
            "./viewType": {isTableLikeView: (type: string) => type === "table" || type === "list"},
            "./virtualScroll": {getAVData: () => data,
                ensureAVTableAdjacentRow: () => assert.fail("range input must stay in its captured selection"),
                ensureAVTableRow: (_block: unknown, rowID: string) => rendered.push(rowID)},
            "./columnWindow": {ensureAVColumnWindow() {}},
            "./selectionState": {getAVCellSelection: () => selection, resolveAVSelectedCell, restoreAVCellSelection() {}},
            "./rangeSelect": {setAVCellAnchor: () => assert.fail("range input must preserve its selection")},
        })[name],
    });
    const open = (cell: HTMLElement) => opened.push({groupID: "group", rowID: cell.closest<HTMLElement>(".av__row").dataset.id,
        colID: cell.dataset.colId});
    const current = () => group.querySelector(`.av__row[data-id="${selection.input.rowID}"]`)
        .querySelector(`.av__cell[data-col-id="${selection.input.colID}"]`);
    const start = () => methods.openAVRangeInput(protyle as unknown as IProtyle, block as unknown as HTMLElement, open);
    const prepare = () => methods.prepareAVContinuousInput(protyle as unknown as IProtyle, block as unknown as HTMLElement,
        [current() as unknown as HTMLElement], open, true);
    return {dom, block, group, columns, rows, points, data, opened, rendered, config, protyle, document, start, prepare, redraw,
        get selection() { return selection; }, changeSelection: () => {selection = {...selection};}};
};

test("preselected rows, columns and rectangles follow row-major order and stop at their boundary", () => {
    for (const [columns, rows] of [[3, 1], [1, 3], [3, 2]]) {
        const f = rangeFixture(["number", "text", "url"].slice(0, columns) as TAVCol[], rows);
        const selection = f.selection;
        assert.equal(f.start(), true);
        for (let index = 0; index < f.points.length; index++) {
            assert.deepEqual(f.opened, f.points.slice(0, index + 1));
            const next = f.prepare();
            f.rows.reverse();
            f.redraw();
            next();
        }
        assert.deepEqual(f.opened, f.points);
        assert.equal(f.selection, selection);
        assert.equal(f.selection.cells.length, f.points.length);
        assert.deepEqual({...f.selection.input}, f.points.at(-1));
        f.prepare()();
        assert.deepEqual(f.opened, f.points);
        assert.ok(f.rendered.length >= f.points.length);
    }
});

test("range input skips readonly, bound primary and dedicated panel fields", () => {
    const f = rangeFixture(["created", "number", "date", "block", "select", "mAsset", "phone"], 1);
    f.selection.cells[3].cell.value.isDetached = false;
    f.start();
    f.prepare()();
    f.prepare()();
    f.prepare()();
    assert.deepEqual(f.opened, [f.points[1], f.points[4], f.points[6]]);
    const readonly = rangeFixture(["created", "updated"], 1);
    assert.equal(readonly.start(), true);
    assert.deepEqual(readonly.opened, []);
});

test("range continuation cancels after target invalidation, other focus or a changed selection", () => {
    for (const state of ["hidden", "type", "removed", "view", "readonly", "disabled", "closed", "focus", "selection", "panel", "staleDOM"]) {
        const f = rangeFixture();
        f.start();
        const next = f.prepare();
        if (state === "hidden") f.columns[1].hidden = true;
        if (state === "type") f.columns[1].type = "number";
        if (state === "removed") f.rows[0].cells.splice(1, 2);
        if (state === "view") f.data.viewID = "other";
        if (state === "readonly") f.config.readonly = true;
        if (state === "disabled") f.protyle.disabled = true;
        if (state === "closed") f.block.remove();
        if (state === "focus") f.document.activeElement = f.dom.createElement("input");
        if (state === "selection") f.changeSelection();
        if (state === "panel") f.document.querySelector = () => ({});
        if (state === "staleDOM") f.group.querySelector('[data-col-id="col1"]').dataset.dtype = "url";
        next();
        assert.deepEqual(f.opened, [f.points[0]], state);
    }
});

test("range input requires an editable connected view and preserves the active cell on reopening", () => {
    for (const state of ["readonly", "disabled", "closed", "panel", "gallery"]) {
        const f = rangeFixture();
        if (state === "readonly") f.config.readonly = true;
        if (state === "disabled") f.protyle.disabled = true;
        if (state === "closed") f.block.remove();
        if (state === "panel") f.document.querySelector = () => ({});
        if (state === "gallery") f.block.dataset.avType = "gallery";
        assert.equal(f.start(), false, state);
        assert.deepEqual(f.opened, [], state);
    }
    const f = rangeFixture();
    f.start();
    const next = f.prepare();
    next();
    next();
    f.start();
    assert.deepEqual(f.opened, [f.points[0], f.points[1], f.points[1]]);
});
