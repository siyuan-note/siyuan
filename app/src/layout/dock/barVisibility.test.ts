import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {shouldShowDockBar} from "./barVisibility";

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
