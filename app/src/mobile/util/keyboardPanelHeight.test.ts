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

test("gesture navigation restoration preserves the panel top through both keyboard transitions", () => {
    for (const [viewport, inset] of [[500, 0], [550, 0], [700, 24], [800, 24], [700, 24], [550, 0], [500, 0]]) {
        const height = getKeyboardPanelHeight(viewport, 452, 48, inset);
        assert.equal(viewport - inset - height, 452);
        assert.equal(viewport - (height + inset), 452);
    }
});

test("minimum toolbar height and fractional gesture insets remain above the navigation area", () => {
    assert.equal(getKeyboardPanelHeight(500, 452, 48, 24), 48);
    assert.equal(getKeyboardPanelHeight(400, 452, 48, 24), 48);
    const height = getKeyboardPanelHeight(620.5, 452.25, 48, 15.75);
    assert.equal(620.5 - 15.75 - height, 452.25);
});
