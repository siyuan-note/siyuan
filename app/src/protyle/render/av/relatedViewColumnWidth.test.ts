import * as assert from "node:assert/strict";
import {test} from "node:test";
import {compileModule, evaluateModule} from "../../../testSupport/loadModule";
import {getAVColumnResizeWidth, updateAVTableColumnWidths} from "./columnWidth";

const compiled = compileModule("src/protyle/render/av/relatedViewColumnWidth.ts");

class Events {
    listeners = new Map<string, Set<(event?: unknown) => void>>();
    addEventListener(type: string, fn: (event?: unknown) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(fn);
    }
    removeEventListener(type: string, fn: (event?: unknown) => void) { this.listeners.get(type)?.delete(fn); }
    emit(type: string, event?: unknown) { [...(this.listeners.get(type) || [])].forEach(fn => fn(event)); }
    count() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

const fixture = () => {
    const window = new Events();
    const handle = Object.assign(new Events(), {
        captured: false, active: false,
        setPointerCapture() { this.captured = true; },
        hasPointerCapture() { return this.captured; },
        releasePointerCapture() { this.captured = false; handle.emit("lostpointercapture"); },
        classList: {add: () => { handle.active = true; }, remove: () => { handle.active = false; }},
        closest: () => handle,
        parentElement: undefined as unknown,
    });
    const cell = {dataset: {colId: "text"}, style: {width: "100px"}, getBoundingClientRect: () => ({width: 100}),
        closest: () => ({querySelectorAll: () => [previous, cell]})};
    const previous = {style: {width: "150px"}, getBoundingClientRect: () => ({width: 150})};
    handle.parentElement = cell;
    const bodyCell = {dataset: {colId: "text"}, style: {width: "100px"}};
    const footer = {dataset: {colId: "text"}, style: {width: "100px"}};
    const other = {dataset: {colId: "other"}, style: {width: "200px"}};
    const table = () => ({columns: [{id: "text", width: "100px"}, {id: "other", width: "200px"}],
        groups: [{columns: [{id: "text", width: "100px"}], groups: [{columns: [{id: "text", width: "100px"}]}]}]});
    let data = {viewType: "table", viewID: "view-a", view: table()};
    const original = structuredClone(data);
    const root = {isConnected: true, querySelectorAll: () => [cell, bodyCell, footer, other]} as unknown as HTMLElement;
    let frozen = 0;
    let allowed = true;
    const widths: import("./relatedViewColumnWidth").TRelatedAVColumnWidths = {};
    const api = evaluateModule<typeof import("./relatedViewColumnWidth")>(compiled, {window,
        require: (id: string) => ({
            "./columnWidth": {getAVColumnResizeWidth, updateAVTableColumnWidths},
            "./frozenColumns": {updateFrozenColumns: () => { frozen++; }},
            "./virtualScroll": {getAVData: () => data},
        })[id] || {},
    });
    const event = (clientX = 10, pointerId = 1, button = 0) => ({target: handle, clientX, pointerId, button,
        preventDefault() {}, stopPropagation() {}} as unknown as PointerEvent);
    return {api, widths, handle, root, cell, bodyCell, footer, other, window, original, event,
        start: (button = 0) => api.startRelatedAVColumnResize(event(10, 1, button), root, widths, () => allowed),
        move: (x: number, pointer = 1) => handle.emit("pointermove", event(x, pointer)),
        deny: () => { allowed = false; }, frozen: () => frozen,
        data: () => data, replace: (viewID = "view-a") => { data = {viewType: "table", viewID, view: table()}; }};
};

test("related resize updates only panel widths, visible cells, footer and recursive virtual/group caches", () => {
    const f = fixture(); f.start(); f.move(62);
    assert.equal(f.widths["view-a"].text, "150px", "Reuse the normal left-column snap");
    for (const cell of [f.cell, f.bodyCell, f.footer]) assert.equal(cell.style.width, "150px");
    assert.equal(f.other.style.width, "200px");
    assert.equal(f.data().view.columns[0].width, "150px");
    assert.equal(f.data().view.groups[0].groups[0].columns[0].width, "150px");
    assert.equal(f.original.view.columns[0].width, "100px");
    assert.equal(f.frozen(), 1);
    f.handle.emit("pointerup");
    assert.equal(f.handle.count(), 0); assert.equal(f.window.count(), 0);
    assert.equal(f.handle.captured, false); assert.equal(f.handle.active, false);
});

test("refresh reapplies temporary widths and each selected view and panel stays isolated", () => {
    const f = fixture(); const stop = f.start(); f.move(110); stop();
    f.replace(); f.api.applyRelatedAVColumnWidths(f.root, f.widths[f.data().viewID]);
    assert.equal(f.data().view.columns[0].width, "200px");
    f.replace("view-b"); f.api.applyRelatedAVColumnWidths(f.root, f.widths[f.data().viewID]);
    assert.equal(f.data().view.columns[0].width, "100px");
    const other = fixture(); assert.deepEqual(other.widths, {});
    assert.equal(other.data().view.columns[0].width, "100px");
});

test("pointer identity, minimum width and CSS scaling are handled without transactions", () => {
    const f = fixture(); f.cell.getBoundingClientRect = () => ({width: 200});
    f.start(); f.move(110, 2); assert.deepEqual(f.widths, {});
    f.move(110); assert.equal(f.widths["view-a"].text, "150px");
    f.move(-1000); assert.equal(f.widths["view-a"].text, "25px");
    f.handle.emit("pointercancel"); assert.equal(f.handle.count(), 0);
});

test("readonly, stale view, disconnected host, blur and explicit disposal stop dragging", () => {
    const denied = fixture(); denied.deny(); assert.equal(denied.start(), undefined);
    assert.equal(denied.handle.count(), 0);
    const right = fixture(); assert.equal(right.start(2), undefined);
    for (const reason of ["readonly", "view", "detached", "blur", "dispose", "capture"]) {
        const f = fixture(); const stop = f.start();
        if (reason === "readonly") f.deny();
        if (reason === "view") f.replace("view-b");
        if (reason === "detached") Object.assign(f.root, {isConnected: false});
        if (reason === "blur") f.window.emit("blur");
        if (reason === "dispose") { stop(); stop(); }
        if (reason === "capture") f.handle.emit("lostpointercapture");
        f.move(110);
        assert.deepEqual(f.widths, {}, reason);
        assert.equal(f.handle.count(), 0, reason);
        assert.equal(f.window.count(), 0, reason);
    }
});

test("related host keeps width handles and width clicks cannot enter shared-view commands", () => {
    let applied = 0;
    let cancelled = 0;
    const removedSelectors: string[] = [];
    const {RelatedAVView} = evaluateModule<{RelatedAVView: {prototype: {rendered: (data: unknown) => void; click: (event: unknown) => void}}}>(
        compileModule("src/protyle/render/av/relatedView.ts") + "\nexports.RelatedAVView = RelatedAVView;", {
            window: {siyuan: {languages: {_attrView: {}}}},
            require: () => ({applyRelatedAVColumnWidths: () => { applied++; }, globalClickHideMenu() {}}),
        });
    const view = Object.assign(Object.create(RelatedAVView.prototype), {
        columnWidths: {table: {text: "250px"}},
        cancelColumnResize: () => { cancelled++; },
        host: {readonly: () => false},
        element: {querySelector: () => ({disabled: false})},
        hostElement: {
            querySelector: (): null => null,
            querySelectorAll: (selector: string): [] => { removedSelectors.push(selector); return []; },
        },
    });
    view.rendered({viewID: "table"});
    assert.equal(applied, 1); assert.equal(cancelled, 1);
    assert.ok(removedSelectors.every(selector => !selector.includes(".av__widthdrag")));
    delete view.host;
    view.click({stopPropagation() {}, target: {closest: (selector: string) => selector === ".av__widthdrag" ? {} : null}});
});
