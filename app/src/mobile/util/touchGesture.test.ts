import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getTouchAxis, shouldStartLongPressMultiSelect} from "./touchGesture";

describe("mobile touch gesture", () => {
    it("waits for the drag threshold before locking the gesture axis", () => {
        assert.equal(getTouchAxis(1, 0, 5), undefined);
        assert.equal(getTouchAxis(1, 12, 5), "y");
    });

    it("locks gestures to their dominant axis", () => {
        assert.equal(getTouchAxis(12, 4, 5), "x");
        assert.equal(getTouchAxis(4, 12, 5), "y");
    });

    it("does not start multi-select for elements with dedicated long-press actions", () => {
        ["block-ref", "file-annotation-ref", "tag", "inline-memo", "a"].forEach(type => {
            assert.equal(shouldStartLongPressMultiSelect("SPAN", type, false, false), false);
        });
        assert.equal(shouldStartLongPressMultiSelect("SPAN", "strong a", false, false), false);
        assert.equal(shouldStartLongPressMultiSelect("PROTYLE-HTML", undefined, true, false), false);
        assert.equal(shouldStartLongPressMultiSelect("IMG", undefined, false, true), false);
    });

    it("starts multi-select for ordinary block content", () => {
        assert.equal(shouldStartLongPressMultiSelect("DIV", undefined, false, false), true);
        assert.equal(shouldStartLongPressMultiSelect("SPAN", "strong", false, false), true);
    });
});
