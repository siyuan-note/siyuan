import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getMobileHintPosition} from "./mobileHintPosition";

describe("getMobileHintPosition", () => {
    it("places the hint below the caret when more space is available there", () => {
        assert.deepEqual(getMobileHintPosition(80, 106, 200, 48, 500), {
            maxHeight: 394,
            top: 106,
        });
    });

    it("places the hint above the caret without covering it", () => {
        assert.deepEqual(getMobileHintPosition(420, 446, 200, 48, 500), {
            maxHeight: 372,
            top: 220,
        });
    });

    it("limits the hint to the available space above the caret", () => {
        assert.deepEqual(getMobileHintPosition(180, 206, 300, 48, 250), {
            maxHeight: 132,
            top: 48,
        });
    });

    it("keeps the hint inside the viewport when the caret is obscured", () => {
        assert.deepEqual(getMobileHintPosition(540, 566, 200, 48, 500), {
            maxHeight: 452,
            top: 300,
        });
        assert.deepEqual(getMobileHintPosition(10, 36, 200, 48, 500), {
            maxHeight: 452,
            top: 48,
        });
    });

    it("limits the hint to part of the visible viewport", () => {
        assert.deepEqual(getMobileHintPosition(420, 446, 400, 48, 500, 226), {
            maxHeight: 226,
            top: 194,
        });
    });
});
