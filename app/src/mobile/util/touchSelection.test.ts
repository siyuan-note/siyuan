import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getMovingSelectionEndpoint,
    hasFixedSelectionEndpointChanged,
    hasVisibleSelectionText,
    shouldRestoreLongPressSelection,
} from "./touchSelection";

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

    it("identifies the endpoint that starts moving", () => {
        assert.equal(getMovingSelectionEndpoint(undefined, true, false), "anchor");
        assert.equal(getMovingSelectionEndpoint(undefined, false, true), "focus");
        assert.equal(getMovingSelectionEndpoint(undefined, false, false), undefined);
        assert.equal(getMovingSelectionEndpoint(undefined, true, true), undefined);
    });

    it("keeps tracking the same moving endpoint for the current gesture", () => {
        assert.equal(getMovingSelectionEndpoint("anchor", false, true), "anchor");
        assert.equal(getMovingSelectionEndpoint("focus", true, false), "focus");
    });

    it("detects changes to the fixed endpoint", () => {
        assert.equal(hasFixedSelectionEndpointChanged("anchor", true, false), false);
        assert.equal(hasFixedSelectionEndpointChanged("anchor", false, true), true);
        assert.equal(hasFixedSelectionEndpointChanged("focus", false, true), false);
        assert.equal(hasFixedSelectionEndpointChanged("focus", true, false), true);
        assert.equal(hasFixedSelectionEndpointChanged(undefined, true, true), false);
    });
});
