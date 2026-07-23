import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    shouldForceBacklinkRefresh,
    shouldRenderBacklinkResponse,
    shouldSaveBacklinkStatus
} from "./backlinkRefresh";

describe("shouldForceBacklinkRefresh", () => {
    it("refreshes reference changes in the owner document while it is focused", () => {
        assert.equal(shouldForceBacklinkRefresh("owner", "owner"), true);
    });

    it("keeps unrelated document changes deferred", () => {
        assert.equal(shouldForceBacklinkRefresh("owner", "other"), false);
        assert.equal(shouldForceBacklinkRefresh("", "other"), false);
    });
});

describe("shouldRenderBacklinkResponse", () => {
    it("skips a stale response when a newer search or refresh is queued", () => {
        assert.equal(shouldRenderBacklinkResponse(false, false), true);
        assert.equal(shouldRenderBacklinkResponse(true, false), false);
        assert.equal(shouldRenderBacklinkResponse(false, true), false);
    });
});

describe("shouldSaveBacklinkStatus", () => {
    it("does not replace saved state with the loading placeholder", () => {
        assert.equal(shouldSaveBacklinkStatus(false, false), true);
        assert.equal(shouldSaveBacklinkStatus(true, false), false);
        assert.equal(shouldSaveBacklinkStatus(false, true), false);
    });
});
