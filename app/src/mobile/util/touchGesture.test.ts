import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getTouchAxis} from "./touchGesture";

describe("mobile touch gesture", () => {
    it("waits for the drag threshold before locking the gesture axis", () => {
        assert.equal(getTouchAxis(1, 0, 5), undefined);
        assert.equal(getTouchAxis(1, 12, 5), "y");
    });

    it("locks gestures to their dominant axis", () => {
        assert.equal(getTouchAxis(12, 4, 5), "x");
        assert.equal(getTouchAxis(4, 12, 5), "y");
    });
});
