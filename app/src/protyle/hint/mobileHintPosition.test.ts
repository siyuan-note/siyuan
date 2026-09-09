import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getMobileHintPosition} from "./mobileHintPosition";

describe("getMobileHintPosition", () => {
    it("keeps the hint directly above the caret", () => {
        assert.deepEqual(getMobileHintPosition(420, 446, 200, 48, 500, Infinity, 8), {
            maxHeight: 364,
            top: 212,
        });
    });

    it("limits the hint to part of the visible viewport", () => {
        assert.deepEqual(getMobileHintPosition(420, 446, 400, 48, 500, 226, 8), {
            maxHeight: 226,
            top: 186,
        });
    });

    it("places the hint below the caret when the space above is too narrow", () => {
        assert.deepEqual(getMobileHintPosition(100, 126, 200, 48, 500, 150, 8), {
            maxHeight: 150,
            top: 134,
        });
        assert.deepEqual(getMobileHintPosition(100, 126, 40, 48, 500, 150, 8), {
            maxHeight: 150,
            top: 134,
        });
    });

    it("keeps the hint above when the space below is even narrower", () => {
        assert.deepEqual(getMobileHintPosition(100, 126, 200, 48, 160, 150, 8), {
            maxHeight: 44,
            top: 48,
        });
    });

    it("uses the configured height limit as the usable-height threshold", () => {
        assert.deepEqual(getMobileHintPosition(100, 126, 200, 48, 500, 40, 8), {
            maxHeight: 40,
            top: 52,
        });
    });
});
