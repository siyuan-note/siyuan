import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    shouldDeferBottomBacklinkRefresh,
    shouldHideBottomBacklinks,
    shouldRenderBacklinkResponse,
    shouldSaveBacklinkStatus
} from "./backlinkRefresh";

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

describe("shouldDeferBottomBacklinkRefresh", () => {
    it("defers automatic refreshes while the owner editor is focused", () => {
        assert.equal(shouldDeferBottomBacklinkRefresh(true, false), true);
        assert.equal(shouldDeferBottomBacklinkRefresh(false, false), false);
    });

    it("allows explicit refreshes to bypass the focus guard", () => {
        assert.equal(shouldDeferBottomBacklinkRefresh(true, true), false);
    });
});

describe("shouldHideBottomBacklinks", () => {
    it("hides the bottom area only when backlinks and mentions are both empty", () => {
        assert.equal(shouldHideBottomBacklinks(0, 0, "", ""), true);
        assert.equal(shouldHideBottomBacklinks(1, 0, "", ""), false);
        assert.equal(shouldHideBottomBacklinks(0, 1, "", ""), false);
    });

    it("keeps the area visible when an active filter has no results", () => {
        assert.equal(shouldHideBottomBacklinks(0, 0, "backlink", ""), false);
        assert.equal(shouldHideBottomBacklinks(0, 0, "", "mention"), false);
    });
});
