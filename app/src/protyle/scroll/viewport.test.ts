import {strict as assert} from "node:assert";
import {describe, it} from "node:test";
import {getVisibleRootBlockID, isScrolledToBottom} from "./viewport";

describe("getVisibleRootBlockID", () => {
    const blocks = [
        {id: "first", top: -100, bottom: 80},
        {id: "second", top: 88, bottom: 240},
        {id: "third", top: 248, bottom: 400},
    ];

    it("returns the first root block intersecting the viewport", () => {
        assert.equal(getVisibleRootBlockID(blocks, 10, 300), "first");
        assert.equal(getVisibleRootBlockID(blocks, 90, 300), "second");
    });

    it("ignores blocks without an id and blocks outside the viewport", () => {
        assert.equal(getVisibleRootBlockID([{id: null, top: 0, bottom: 100}, ...blocks], 90, 240), "second");
        assert.equal(getVisibleRootBlockID(blocks, 500, 700), undefined);
    });
});

describe("isScrolledToBottom", () => {
    it("allows fractional pixel differences at the bottom", () => {
        assert.equal(isScrolledToBottom(699.5, 1000, 300), true);
        assert.equal(isScrolledToBottom(698, 1000, 300), false);
    });
});
