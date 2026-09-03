import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    hasOverlappingTrackedTokenContext,
    hasTrackedTokenRangeAffinityChoice,
    mapTrackedTokenRange,
} from "./trackedRangeAnchor";

describe("tracked range token mapping", () => {
    it("keeps a collapsed before-affinity anchor ahead of inserted tokens", () => {
        assert.deepEqual(mapTrackedTokenRange(
            ["a", "b", "c", "d"],
            ["a", "b", "inserted", "c", "d"],
            {start: 2, end: 2},
            true,
            "before",
        ), {start: 2, end: 2});
    });

    it("moves an after-affinity anchor behind inserted tokens", () => {
        assert.deepEqual(mapTrackedTokenRange(
            ["a", "b", "c", "d"],
            ["a", "b", "inserted", "c", "d"],
            {start: 2, end: 2},
            true,
            "after",
        ), {start: 3, end: 3});
    });

    it("detects when an insertion at a collapsed anchor requires affinity", () => {
        assert.equal(hasTrackedTokenRangeAffinityChoice(
            ["a", "b", "c"],
            ["a", "b", "inserted", "c"],
            2,
        ), true);
    });

    it("does not require affinity for edits away from a collapsed anchor", () => {
        assert.equal(hasTrackedTokenRangeAffinityChoice(
            ["old", "a", "b"],
            ["new", "a", "b"],
            2,
        ), false);
    });

    it("rejects overlapping prefix and suffix interpretations without edit evidence", () => {
        assert.equal(hasOverlappingTrackedTokenContext(["a", "a"], ["a", "b", "a", "a"]), true);
        assert.equal(mapTrackedTokenRange(
            ["a", "a"],
            ["a", "b", "a", "a"],
            {start: 0, end: 0},
            true,
            "after",
        ), undefined);
        assert.equal(mapTrackedTokenRange(
            ["c", "b", "a"],
            ["c", "b", "b", "a"],
            {start: 1, end: 1},
            true,
            "after",
        ), undefined);
    });

    it("does not redirect an anchor to an identical sibling inserted before its source", () => {
        assert.equal(mapTrackedTokenRange(
            ["editable-boundary", "text:a"],
            ["editable-boundary", "text:a", "editable-boundary", "text:a"],
            {start: 2, end: 2},
            true,
            "before",
        ), undefined);
    });

    it("applies affinity to overlapping context when the edit position is known", () => {
        assert.deepEqual(mapTrackedTokenRange(
            ["c", "b", "a"],
            ["c", "b", "b", "a"],
            {start: 1, end: 1},
            true,
            "after",
            true,
        ), {start: 2, end: 2});
        assert.deepEqual(mapTrackedTokenRange(
            ["same", "same"],
            ["same", "same", "same"],
            {start: 1, end: 1},
            true,
            "after",
            true,
        ), {start: 2, end: 2});
    });

    it("maps a collapsed anchor when content immediately before it is deleted", () => {
        assert.deepEqual(mapTrackedTokenRange(
            ["a", "b", "c"],
            ["a", "c"],
            {start: 2, end: 2},
            true,
            "before",
        ), {start: 1, end: 1});
    });

    it("maps a collapsed anchor when content immediately after it is deleted", () => {
        assert.deepEqual(mapTrackedTokenRange(
            ["a", "b", "c"],
            ["a", "b"],
            {start: 2, end: 2},
            true,
            "after",
        ), {start: 2, end: 2});
    });

    it("keeps boundary insertions outside a protected target", () => {
        assert.deepEqual(mapTrackedTokenRange(
            ["a", "target", "c"],
            ["a", "inserted", "target", "c"],
            {start: 1, end: 2},
            false,
            "before",
        ), {start: 2, end: 3});
        assert.deepEqual(mapTrackedTokenRange(
            ["a", "target", "c"],
            ["a", "target", "inserted", "c"],
            {start: 1, end: 2},
            false,
            "before",
        ), {start: 1, end: 2});
    });

    it("invalidates a protected target modified internally", () => {
        assert.equal(mapTrackedTokenRange(
            ["a", "target-1", "target-2", "c"],
            ["a", "target-1", "inserted", "target-2", "c"],
            {start: 1, end: 3},
            false,
            "before",
        ), undefined);
    });

    it("does not redirect a deleted target to an identical copy", () => {
        assert.equal(mapTrackedTokenRange(
            ["left", "target", "middle", "target", "right"],
            ["left", "middle", "target", "right"],
            {start: 1, end: 2},
            false,
            "before",
        ), undefined);
    });

    it("does not treat a shifted duplicate as a stable prefix", () => {
        assert.equal(mapTrackedTokenRange(
            ["same", "same"],
            ["same", "placeholder"],
            {start: 0, end: 1},
            false,
            "before",
        ), undefined);
        assert.equal(mapTrackedTokenRange(
            ["same", "editable-boundary", "same"],
            ["same"],
            {start: 0, end: 1},
            false,
            "before",
        ), undefined);
    });

    it("distinguishes duplicate targets by their semantic context", () => {
        assert.deepEqual(mapTrackedTokenRange(
            ["left-a", "same", "right-a", "left-b", "same", "right-b"],
            ["inserted", "left-a", "same", "right-a", "left-b", "same", "right-b"],
            {start: 1, end: 2},
            false,
            "before",
        ), {start: 2, end: 3});
    });

    it("rejects a duplicate that can impersonate a deleted target", () => {
        assert.equal(mapTrackedTokenRange(
            ["a", "target", "between", "target", "c"],
            ["a", "target", "c"],
            {start: 1, end: 2},
            false,
            "before",
        ), undefined);
    });

    it("invalidates indistinguishable repeated content", () => {
        assert.equal(mapTrackedTokenRange(
            ["same", "same", "same"],
            ["same", "same", "same", "same"],
            {start: 1, end: 2},
            false,
            "before",
        ), undefined);
    });

    it("maps content across an inserted block boundary", () => {
        assert.deepEqual(mapTrackedTokenRange(
            ["a", "b", "c", "d"],
            ["a", "b", "editable-boundary", "c", "d"],
            {start: 2, end: 4},
            false,
            "before",
        ), {start: 3, end: 5});
        assert.equal(mapTrackedTokenRange(
            ["a", "b", "c", "d"],
            ["a", "b", "editable-boundary", "c", "d"],
            {start: 1, end: 3},
            false,
            "before",
        ), undefined);
    });

    it("rejects affinity when a repeated collapsed anchor is ambiguous", () => {
        assert.equal(mapTrackedTokenRange(
            ["same", "same"],
            ["same", "same", "same"],
            {start: 1, end: 1},
            true,
            "after",
        ), undefined);
    });

    it("runs in linear time for long repeated input", () => {
        const before = Array.from({length: 100_000}, () => "same");
        const after = before.concat("same");
        const started = performance.now();
        const result = mapTrackedTokenRange(before, after, {start: 50_000, end: 50_001}, false, "before");

        assert.equal(result, undefined);
        assert.ok(performance.now() - started < 2_000);
    });
});
