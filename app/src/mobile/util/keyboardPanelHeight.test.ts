import {test} from "node:test";
import * as assert from "node:assert/strict";
import {getKeyboardPanelHeight} from "./keyboardPanelHeight";

test("keyboard and menu handoff keeps the toolbar top fixed in both directions", () => {
    const panelTop = 452;
    const viewportBottoms = [500, 550, 700, 800, 700, 550, 500];
    for (const bottom of viewportBottoms) {
        const height = getKeyboardPanelHeight(bottom, panelTop, 48);
        assert.equal(bottom - height, panelTop);
    }
});

test("a taller replacement keyboard leaves the toolbar fully visible", () => {
    assert.equal(getKeyboardPanelHeight(400, 452, 48), 48);
});

test("viewport offsets and fractional heights retain the handoff position", () => {
    const height = getKeyboardPanelHeight(620.5, 452.25, 48);
    assert.equal(620.5 - height, 452.25);
});
