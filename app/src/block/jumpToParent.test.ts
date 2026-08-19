import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {shouldFocusJumpTarget} from "./jumpToParent";

describe("shouldFocusJumpTarget", () => {
    it("focuses a target hidden by folding", () => {
        assert.equal(shouldFocusJumpTarget({
            isRoot: false,
            showAll: false,
            isFolded: true,
            isHidden: true,
        }), true);
    });

    it("keeps visible folded targets in the full document", () => {
        assert.equal(shouldFocusJumpTarget({
            isRoot: false,
            showAll: false,
            isFolded: true,
            isHidden: false,
        }), false);
    });

    it("preserves an existing focus", () => {
        assert.equal(shouldFocusJumpTarget({
            isRoot: false,
            showAll: true,
            isFolded: false,
            isHidden: false,
        }), true);
    });

    it("does not focus the root document", () => {
        assert.equal(shouldFocusJumpTarget({
            isRoot: true,
            showAll: true,
            isFolded: true,
            isHidden: true,
        }), false);
    });
});
