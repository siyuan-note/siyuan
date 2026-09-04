import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getMobileHintPosition} from "./mobileHintPosition";

describe("getMobileHintPosition", () => {
    it("keeps the hint directly above the caret", () => {
        assert.deepEqual(getMobileHintPosition(420, 200, 48, 500, Infinity, 8), {
            maxHeight: 364,
            top: 212,
        });
    });

    it("limits the hint to part of the visible viewport", () => {
        assert.deepEqual(getMobileHintPosition(420, 400, 48, 500, 226, 8), {
            maxHeight: 226,
            top: 186,
        });
    });

    it("keeps the hint inside the viewport when little space is available", () => {
        assert.deepEqual(getMobileHintPosition(60, 100, 48, 500, Infinity, 8), {
            maxHeight: 4,
            top: 48,
        });
    });
});
