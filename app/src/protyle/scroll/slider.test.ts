import {strict as assert} from "node:assert";
import {describe, it} from "node:test";
import {getScrollIndexFromPointer} from "./slider";

describe("getScrollIndexFromPointer", () => {
    const rect = {top: 100, height: 200} as DOMRect;

    it("maps the vertical touch position to a block index", () => {
        assert.equal(getScrollIndexFromPointer(100, rect, 1, 101), 1);
        assert.equal(getScrollIndexFromPointer(200, rect, 1, 101), 51);
        assert.equal(getScrollIndexFromPointer(300, rect, 1, 101), 101);
    });

    it("clamps positions outside the slider track", () => {
        assert.equal(getScrollIndexFromPointer(0, rect, 1, 101), 1);
        assert.equal(getScrollIndexFromPointer(400, rect, 1, 101), 101);
    });

    it("keeps the only available index", () => {
        assert.equal(getScrollIndexFromPointer(200, rect, 1, 1), 1);
    });
});
