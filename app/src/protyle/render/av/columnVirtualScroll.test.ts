import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getAVColumnWindow} from "./columnVirtualScroll";

const columns = Array.from({length: 35}, (_, index) => ({id: `column-${index}`, width: 200}));

test("column windows include visible columns and a small width buffer", () => {
    const window = getAVColumnWindow({columns, viewportLeft: 800, viewportWidth: 600, leadingWidth: 32});
    assert.deepEqual([...window.columnIDs], ["column-3", "column-4", "column-5", "column-6", "column-7"]);
    assert.equal(window.totalWidth, 7032);
    assert.equal(columns.length, 35);
});

test("frozen columns stay mounted beyond the scroll viewport", () => {
    const window = getAVColumnWindow({columns: columns.map((column, index) => ({...column, pinned: index < 2})),
        viewportLeft: 6200, viewportWidth: 600, leadingWidth: 32, occludedWidth: 432, buffer: 0});
    assert.deepEqual([...window.columnIDs], ["column-0", "column-1", "column-33"]);
    assert.equal(window.totalWidth, 7032);
});

test("fractional widths and exact column boundaries preserve the horizontal extent", () => {
    const window = getAVColumnWindow({columns: [{id: "a", width: 75.25}, {id: "b", width: 100.5},
        {id: "c", width: 40.25}], viewportLeft: 91.25, viewportWidth: 100.5, leadingWidth: 16, buffer: 0});
    assert.deepEqual([...window.columnIDs], ["b"]);
    assert.equal(window.totalWidth, 232);
});

test("columns outside a clipped group can all be unmounted without changing its extent", () => {
    const window = getAVColumnWindow({columns, viewportLeft: -1000, viewportWidth: 300, buffer: 0});
    assert.equal(window.columnIDs.size, 0);
    assert.equal(window.totalWidth, 7000);
});

test("unmeasurable, duplicate and malformed geometry leaves virtualization disabled", () => {
    for (const options of [
        {columns, viewportLeft: 0, viewportWidth: 0},
        {columns, viewportLeft: NaN, viewportWidth: 800},
        {columns, viewportLeft: 0, viewportWidth: 800, buffer: -1},
        {columns, viewportLeft: 0, viewportWidth: 800, leadingWidth: Infinity},
        {columns: [{id: "a", width: 0}], viewportLeft: 0, viewportWidth: 800},
        {columns: [{id: "a", width: 10}, {id: "a", width: 10}], viewportLeft: 0, viewportWidth: 800},
    ]) {
        assert.equal(getAVColumnWindow(options), undefined);
    }
});
