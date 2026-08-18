import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getPendingBlockFocusMode, hasFocusOffsets, shouldFocusAfterZoom} from "./focusRestore";

describe("shouldFocusAfterZoom", () => {
    it("focuses a block entered through regular navigation", () => {
        assert.equal(shouldFocusAfterZoom({
            id: "block-id",
            rootID: "root-id",
            isPushBack: true,
        }), true);
    });

    it("leaves back and forward navigation to its focus callback", () => {
        assert.equal(shouldFocusAfterZoom({
            id: "block-id",
            rootID: "root-id",
            isPushBack: false,
        }), false);
    });

    it("focuses an explicit target when exiting focus", () => {
        assert.equal(shouldFocusAfterZoom({
            focusId: "block-id",
            id: "root-id",
            rootID: "root-id",
            isPushBack: false,
        }), true);
    });

    it("does not move focus for a regular root document reload", () => {
        assert.equal(shouldFocusAfterZoom({
            id: "root-id",
            rootID: "root-id",
            isPushBack: true,
        }), false);
    });
});

describe("hasFocusOffsets", () => {
    it("accepts zero offsets", () => {
        assert.equal(hasFocusOffsets({
            rootId: "root-id",
            focusId: "block-id",
            focusStart: 0,
            focusEnd: 0,
        }), true);
    });

    it("rejects a focus target without offsets", () => {
        assert.equal(hasFocusOffsets({
            rootId: "root-id",
            focusId: "block-id",
        }), false);
    });

    it("rejects offsets without a focus target", () => {
        assert.equal(hasFocusOffsets({
            rootId: "root-id",
            focusStart: 0,
            focusEnd: 0,
        }), false);
    });
});

describe("getPendingBlockFocusMode", () => {
    it("preserves the zoom focus strategy through asynchronous rendering", () => {
        assert.equal(getPendingBlockFocusMode("zoom"), "zoom");
    });

    it("keeps the existing default focus strategy", () => {
        assert.equal(getPendingBlockFocusMode("true"), "default");
    });

    it("ignores unrelated attribute values", () => {
        assert.equal(getPendingBlockFocusMode("false"), undefined);
    });
});
