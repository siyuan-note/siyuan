import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getCalendarPreviewTop} from "./preview";

test("calendar preview uses free space without covering existing entries", () => {
    const items = [{left: 0, right: 100, top: 30, bottom: 60},
        {left: 100, right: 200, top: 30, bottom: 60}, {left: 0, right: 100, top: 95, bottom: 125}];
    assert.equal(getCalendarPreviewTop(30, 25, 0, 100, items, 3), 63);
    assert.equal(getCalendarPreviewTop(30, 25, 200, 300, items, 3), 30);
    assert.equal(getCalendarPreviewTop(30, 40, 0, 100, items, 3), 128);
});

test("calendar preview clears all covered columns and variable-height content", () => {
    const items = [{left: 100, right: 200, top: 65, bottom: 100},
        {left: 0, right: 100, top: 30, bottom: 95}, {left: 100, right: 200, top: 103, bottom: 125}];
    assert.equal(getCalendarPreviewTop(30, 28, 0, 200, items, 3), 128);
    assert.equal(getCalendarPreviewTop(30, 28, 0, 100, items, 3), 98);
    assert.equal(items[0].top, 65);
});
