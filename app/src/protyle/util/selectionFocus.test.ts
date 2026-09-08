import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getUndoFocusElement, getUndoFocusTarget} from "./selectionFocus";

describe("getUndoFocusElement", () => {
    it("uses the recorded duplicate index when it remains available", () => {
        assert.equal(getUndoFocusElement(["source", "embed"], "1", item => item === "source"), "embed");
    });

    it("does not silently reuse the first copy when the recorded index is missing", () => {
        assert.equal(getUndoFocusElement(["embed"], "1", item => item === "source"), undefined);
    });

    it("requires an unambiguous candidate for older contexts without an index", () => {
        assert.equal(getUndoFocusElement(["source", "embed"], undefined, item => item === "source"), "source");
        assert.equal(getUndoFocusElement(["embed-a", "embed-b"], undefined, () => true), undefined);
    });

    it("does not fall back to another scope while the target embed is rendering", () => {
        assert.equal(getUndoFocusElement([], "1", () => true), undefined);
    });
});

describe("getUndoFocusTarget", () => {
    it("uses the duplicate containing the restored selection", () => {
        assert.equal(getUndoFocusTarget(["embed", "source"], item => item === "source"), "source");
    });

    it("falls back to the first duplicate without a matching selection", () => {
        assert.equal(getUndoFocusTarget(["embed", "source"], () => false), "embed");
    });
});
