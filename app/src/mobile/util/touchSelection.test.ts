import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {hasVisibleSelectionText, shouldRestoreLongPressSelection} from "./touchSelection";

describe("mobile touch selection", () => {
    it("rejects selections containing only block placeholders", () => {
        assert.equal(hasVisibleSelectionText("\u200b"), false);
        assert.equal(hasVisibleSelectionText("\u200b\n\u200b\u200b"), false);
    });

    it("preserves selections containing visible text", () => {
        assert.equal(hasVisibleSelectionText("\u200b内容\u200b"), true);
    });

    it("restores invisible cross-block selections involving the long-pressed block", () => {
        assert.equal(shouldRestoreLongPressSelection(false, "\u200b\n", "current", "next", "current"), true);
        assert.equal(shouldRestoreLongPressSelection(false, "\u200b\n", "current", "next", "next"), true);
    });

    it("keeps ordinary selections unchanged", () => {
        assert.equal(shouldRestoreLongPressSelection(false, "内容", "current", "next", "current"), false);
        assert.equal(shouldRestoreLongPressSelection(true, "", "current", "next", "current"), false);
        assert.equal(shouldRestoreLongPressSelection(false, "\u200b", "current", "current", "current"), false);
        assert.equal(shouldRestoreLongPressSelection(false, "\u200b", "current", "next", "other"), false);
        assert.equal(shouldRestoreLongPressSelection(false, "\u200b", undefined, "next", "next"), false);
    });
});
