import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getSavedScrollRange, getScrollRequestParams} from "./scrollRequest";

describe("getSavedScrollRange", () => {
    it("keeps a complete range", () => {
        assert.deepEqual(getSavedScrollRange("first", "last"), {
            startId: "first",
            endId: "last",
        });
    });

    it("discards an incomplete range", () => {
        assert.deepEqual(getSavedScrollRange(null, "last"), {});
        assert.deepEqual(getSavedScrollRange("first", null), {});
    });
});

describe("getScrollRequestParams", () => {
    it("keeps the configured size and a complete saved range", () => {
        assert.deepEqual(getScrollRequestParams(192, "first", "last"), {
            size: 192,
            startID: "first",
            endID: "last",
        });
    });

    it("keeps the configured size when discarding an incomplete range", () => {
        assert.deepEqual(getScrollRequestParams(192, null, "last"), {size: 192});
        assert.deepEqual(getScrollRequestParams(192, "first", null), {size: 192});
    });
});
