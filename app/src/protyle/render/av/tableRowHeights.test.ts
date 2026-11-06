import * as assert from "node:assert/strict";
import {test} from "node:test";
import {AVTableRowHeights} from "./tableRowHeights";
import {getGroupTableViewportWindow} from "./groupTableVirtual";

test("table row offsets retain a tall measured row without multiplying its height into other rows", () => {
    const heights = new AVTableRowHeights(60, 34);
    heights.set(0, 580);
    assert.equal(heights.offset(25), 580 + 24 * 34);
    assert.equal(heights.offset(60) - heights.offset(25), 35 * 34);
    assert.equal(heights.indexAt(579), 0);
    assert.equal(heights.indexAt(580), 1);
    assert.equal(heights.indexAt(-1), 0);
    assert.equal(heights.indexAt(100000), 59);
    heights.set(0, 34);
    assert.equal(heights.offset(60), 60 * 34);
    heights.set(60, 900);
    heights.set(1, NaN);
    heights.set(NaN, 900);
    heights.set(1.5, 900);
    assert.equal(heights.offset(60), 60 * 34);
});

test("a variable-height window includes intersecting tall rows and the viewport bottom", () => {
    const heights = new AVTableRowHeights(60, 34);
    heights.set(0, 580);
    heights.set(30, 300);
    for (const [top, bottom] of [[150, 450], [1620, 1920], [181, 253], [0, 300]]) {
        const result = getGroupTableViewportWindow({dataStart: 0, dataEnd: 59, bodyTop: 0,
            headerHeight: 0, viewportTop: top, viewportBottom: bottom, rowHeight: 34,
            bufferRatio: 0.25, rowHeights: heights});
        assert.ok(heights.offset(result.renderedStart) <= top);
        assert.ok(heights.offset(result.renderedEnd + 1) >= bottom);
    }
});

test("quarter-screen fixed-height windows cover fractional two- and three-row viewports", () => {
    for (const [rowHeight, top, bottom] of [[100, 1620, 1920], [36, 181, 253]]) {
        const result = getGroupTableViewportWindow({dataStart: 0, dataEnd: 99, bodyTop: 0,
            headerHeight: 0, viewportTop: top, viewportBottom: bottom, rowHeight, bufferRatio: 0.25});
        assert.ok(result.renderedStart * rowHeight <= top);
        assert.ok((result.renderedEnd + 1) * rowHeight >= bottom);
    }
});
