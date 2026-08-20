import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getKeyboardHideResult,
    getMovingSelectionEndpoint,
    hasFixedSelectionEndpointChanged,
    hasVisibleSelectionText,
    isTableCellSelectAll,
    KeyboardHideResult,
    shouldHideKeyboardAfterResize,
    shouldRestoreLongPressSelection,
    shouldPreserveTableCellSelectAll,
} from "./touchSelection";

describe("mobile touch selection", () => {
    it("rejects selections containing only block placeholders", () => {
        assert.equal(hasVisibleSelectionText("\u200b"), false);
        assert.equal(hasVisibleSelectionText("\u200b\n\u200b\u200b"), false);
    });

    it("preserves selections containing visible text", () => {
        assert.equal(hasVisibleSelectionText("\u200b内容\u200b"), true);
    });

    it("identifies table cell select all while ignoring placeholders", () => {
        assert.equal(isTableCellSelectAll("段落块", "段落块"), true);
        assert.equal(isTableCellSelectAll("\u200b段落块\u200b", "段落块"), true);
        assert.equal(isTableCellSelectAll("段落", "段落块"), false);
        assert.equal(isTableCellSelectAll("\u200b", "\u200b"), false);
    });

    it("preserves recent table cell select all once the keyboard state changes", () => {
        assert.equal(shouldPreserveTableCellSelectAll(1500, 1499), true);
        assert.equal(shouldPreserveTableCellSelectAll(1500, 1500), true);
        assert.equal(shouldPreserveTableCellSelectAll(1500, 1501), false);
    });

    it("does not enqueue another keyboard hide while preserving table cell select all", () => {
        assert.equal(shouldHideKeyboardAfterResize(false, true), false);
        assert.equal(shouldHideKeyboardAfterResize(true, false), false);
        assert.equal(shouldHideKeyboardAfterResize(false, false), true);
    });

    it("preserves a visible editor selection after a passive keyboard hide", () => {
        assert.equal(getKeyboardHideResult(true, false, true), KeyboardHideResult.PreserveSelection);
        assert.equal(getKeyboardHideResult(true, false, false), KeyboardHideResult.Cleanup);
        assert.equal(getKeyboardHideResult(false, false, true), KeyboardHideResult.Cleanup);
    });

    it("restores table cell selection before considering ordinary text selection", () => {
        assert.equal(getKeyboardHideResult(true, true, true), KeyboardHideResult.RestoreTableCellSelection);
        assert.equal(getKeyboardHideResult(true, true, false), KeyboardHideResult.RestoreTableCellSelection);
        assert.equal(getKeyboardHideResult(false, true, true), KeyboardHideResult.Cleanup);
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
