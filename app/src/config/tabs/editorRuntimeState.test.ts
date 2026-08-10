import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {shouldResetBottomBacklinkPanel} from "./editorRuntimeState";

describe("shouldResetBottomBacklinkPanel", () => {
    it("keeps the panel when expand counts do not change", () => {
        assert.equal(shouldResetBottomBacklinkPanel(
            {backlinkExpandCount: 8, backmentionExpandCount: -1},
            {backlinkExpandCount: 8, backmentionExpandCount: -1},
        ), false);
    });

    it("resets the panel when the backlink expand count changes", () => {
        assert.equal(shouldResetBottomBacklinkPanel(
            {backlinkExpandCount: 8, backmentionExpandCount: -1},
            {backlinkExpandCount: 10, backmentionExpandCount: -1},
        ), true);
    });

    it("resets the panel when the mention expand count changes", () => {
        assert.equal(shouldResetBottomBacklinkPanel(
            {backlinkExpandCount: 8, backmentionExpandCount: 8},
            {backlinkExpandCount: 8, backmentionExpandCount: 0},
        ), true);
    });
});
