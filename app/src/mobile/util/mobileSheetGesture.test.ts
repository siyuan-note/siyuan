import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getMobileSheetBounds, moveSheetGesture, SheetGesture} from "./mobileSheetGesture";

const gesture = (height = 700): SheetGesture => ({height, min: 180, max: 800, offset: 0, time: 0});

test("minimum fits short content and chrome while respecting the available region", () => {
    assert.deepEqual(getMobileSheetBounds(100, 40, 800), {min: 100, max: 800});
    assert.deepEqual(getMobileSheetBounds(900, 80, 800), {min: 200, max: 800});
    assert.deepEqual(getMobileSheetBounds(900, 80, 90), {min: 90, max: 90});
});

test("large shrink is resize only until the same drag moves beyond the minimum", () => {
    const state = gesture();
    assert.deepEqual(moveSheetGesture(state, 500, 20), {height: 200, excess: 0, close: false});
    assert.deepEqual(moveSheetGesture(state, 520, 30), {height: 180, excess: 0, close: false});
    assert.equal(moveSheetGesture(state, 570, 200).close, true);
});

test("velocity is measured only beyond minimum with interpolated crossing time", () => {
    const state = gesture();
    moveSheetGesture(state, 500, 1000);
    assert.equal(moveSheetGesture(state, 545, 1100).close, false);
    assert.equal(state.phaseStart, 1000 + 100 * 20 / 45);
    const fast = gesture();
    moveSheetGesture(fast, 520, 1000);
    assert.equal(moveSheetGesture(fast, 545, 1020).close, true);
});

test("reversal resets excess phase and upper travel clamps without closing", () => {
    const state = gesture();
    moveSheetGesture(state, 550, 100);
    assert.equal(moveSheetGesture(state, 400, 200).close, false);
    assert.equal(state.phaseStart, undefined);
    assert.deepEqual(moveSheetGesture(state, -900, 300), {height: 800, excess: 0, close: false});
});
