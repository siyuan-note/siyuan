import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {shouldShowDockBar, shouldShowDockSplit} from "./barVisibility";

describe("dock bar visibility", () => {
    it("shows a non-empty dock bar when dock bars are enabled", () => {
        assert.equal(shouldShowDockBar(false, true), true);
    });

    it("hides an empty dock bar", () => {
        assert.equal(shouldShowDockBar(false, false), false);
    });

    it("keeps dock bars hidden when they are globally disabled", () => {
        assert.equal(shouldShowDockBar(true, true), false);
        assert.equal(shouldShowDockBar(true, false), false);
    });
});

describe("dock split visibility", () => {
    it("shows the split when both adjacent sections contain visible entries", () => {
        assert.equal(shouldShowDockSplit(true, true), true);
    });

    it("hides the split when either adjacent section is empty", () => {
        assert.equal(shouldShowDockSplit(false, true), false);
        assert.equal(shouldShowDockSplit(true, false), false);
        assert.equal(shouldShowDockSplit(false, false), false);
    });
});
