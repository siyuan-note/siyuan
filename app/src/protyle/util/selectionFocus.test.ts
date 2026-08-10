import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getUndoFocusElement} from "./selectionFocus";

describe("getUndoFocusElement", () => {
    it("uses the recorded duplicate index when it remains available", () => {
        assert.equal(getUndoFocusElement(["source", "embed"], "1", item => item === "source"), "embed");
    });

    it("uses the target embed element when the global duplicate index is outside its scope", () => {
        assert.equal(getUndoFocusElement(["embed"], "1", item => item === "source"), "embed");
    });

    it("does not fall back to another scope while the target embed is rendering", () => {
        assert.equal(getUndoFocusElement([], "1", () => true), undefined);
    });
});
