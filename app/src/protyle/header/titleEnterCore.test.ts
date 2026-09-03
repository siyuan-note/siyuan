import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getTitleEnterAction} from "./titleEnterCore";

const getAction = (options: Partial<Parameters<typeof getTitleEnterAction>[0]> = {}) => getTitleEnterAction({
    documentStartLoaded: true,
    hasFirstBlock: true,
    firstBlockIsList: false,
    firstEditableIsEmpty: false,
    firstEditableHasPlaceholder: false,
    ...options,
});

describe("getTitleEnterAction", () => {
    it("loads the document start when the current range begins later", () => {
        assert.equal(getAction({documentStartLoaded: false}), "load");
    });

    it("loads the document start when no first block is available", () => {
        assert.equal(getAction({hasFirstBlock: false}), "load");
    });

    it("focuses an empty first block with a placeholder", () => {
        assert.equal(getAction({firstEditableIsEmpty: true, firstEditableHasPlaceholder: true}), "focus");
    });

    it("focuses a list first block", () => {
        assert.equal(getAction({firstBlockIsList: true}), "focus");
    });

    it("inserts a paragraph before existing content", () => {
        assert.equal(getAction(), "insert");
    });
});
