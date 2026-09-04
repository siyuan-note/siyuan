import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getMobileHintPosition} from "./mobileHintPosition";

describe("getMobileHintPosition", () => {
    it("places the hint below the caret when more space is available there", () => {
        assert.deepEqual(getMobileHintPosition(80, 106, 48, 500), {
            maxHeight: 394,
            top: 106,
        });
    });

    it("places the hint above the caret without covering it", () => {
        assert.deepEqual(getMobileHintPosition(420, 446, 48, 500), {
            maxHeight: 372,
            top: 48,
        });
    });

    it("limits the hint to the available space above the caret", () => {
        assert.deepEqual(getMobileHintPosition(180, 206, 48, 250), {
            maxHeight: 132,
            top: 48,
        });
    });

    it("keeps the hint inside the viewport when the caret is obscured", () => {
        assert.deepEqual(getMobileHintPosition(540, 566, 48, 500), {
            maxHeight: 452,
            top: 48,
        });
        assert.deepEqual(getMobileHintPosition(10, 36, 48, 500), {
            maxHeight: 452,
            top: 48,
        });
    });

    it("limits the hint to part of the visible viewport", () => {
        assert.deepEqual(getMobileHintPosition(420, 446, 48, 500, 226), {
            maxHeight: 226,
            top: 48,
        });
    });

    it("leaves a gap around the caret line", () => {
        assert.deepEqual(getMobileHintPosition(420, 446, 48, 500, Infinity, 4), {
            maxHeight: 368,
            top: 48,
        });
        assert.deepEqual(getMobileHintPosition(80, 106, 48, 500, Infinity, 4), {
            maxHeight: 390,
            top: 110,
        });
    });
});
