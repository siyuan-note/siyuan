import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getAVVerticalNavigationAction,
    shouldPreserveAVSelectionOnKeyup,
    shouldRunAVKeyupFallback,
} from "./verticalNavigation";

describe("database vertical navigation", () => {
    it("moves inside the database when an adjacent item exists", () => {
        assert.equal(getAVVerticalNavigationAction(true), "move");
    });

    it("leaves the database at its logical item boundary", () => {
        assert.equal(getAVVerticalNavigationAction(false), "leave");
    });

    it("preserves a database selection created by an arrow keydown", () => {
        assert.equal(shouldPreserveAVSelectionOnKeyup("ArrowUp", true), true);
        assert.equal(shouldPreserveAVSelectionOnKeyup("ArrowUp", false), false);
        assert.equal(shouldPreserveAVSelectionOnKeyup("Enter", true), false);
    });

    it("does not run the legacy keyup fallback after keydown handled navigation", () => {
        assert.equal(shouldRunAVKeyupFallback(true, true), false);
        assert.equal(shouldRunAVKeyupFallback(false, true), true);
    });
});
