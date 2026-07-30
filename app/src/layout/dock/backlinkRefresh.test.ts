import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getBottomBacklinkVisibility,
    getInitialBacklinkSectionState,
    shouldDeferBottomBacklinkRefresh,
    shouldRefreshAllBacklinkContexts,
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
    it("defers automatic refreshes while the backlink panel is focused", () => {
        assert.equal(shouldDeferBottomBacklinkRefresh(true, false), true);
        assert.equal(shouldDeferBottomBacklinkRefresh(false, false), false);
    });

    it("allows explicit refreshes to bypass the focus guard", () => {
        assert.equal(shouldDeferBottomBacklinkRefresh(true, true), false);
    });
});

describe("getBottomBacklinkVisibility", () => {
    it("hides empty sections independently", () => {
        assert.deepEqual(getBottomBacklinkVisibility(0, 0, "", ""), {
            hideBacklinks: true,
            hideMentions: true,
            hidePanel: true,
        });
        assert.deepEqual(getBottomBacklinkVisibility(1, 0, "", ""), {
            hideBacklinks: false,
            hideMentions: true,
            hidePanel: false,
        });
        assert.deepEqual(getBottomBacklinkVisibility(0, 1, "", ""), {
            hideBacklinks: true,
            hideMentions: false,
            hidePanel: false,
        });
    });

    it("keeps the filtered section visible when it has no results", () => {
        assert.deepEqual(getBottomBacklinkVisibility(0, 0, "backlink", ""), {
            hideBacklinks: false,
            hideMentions: true,
            hidePanel: false,
        });
        assert.deepEqual(getBottomBacklinkVisibility(0, 0, "", "mention"), {
            hideBacklinks: true,
            hideMentions: false,
            hidePanel: false,
        });
    });
});

describe("getInitialBacklinkSectionState", () => {
    const ids = ["one", "two", "three"];

    it("folds the section when configured to minus one", () => {
        assert.deepEqual(getInitialBacklinkSectionState(-1, ids), {
            folded: true,
            openIds: [],
        });
    });

    it("keeps contexts folded when configured to zero", () => {
        assert.deepEqual(getInitialBacklinkSectionState(0, ids), {
            folded: false,
            openIds: [],
        });
    });

    it("opens only the configured number of contexts", () => {
        assert.deepEqual(getInitialBacklinkSectionState(2, ids), {
            folded: false,
            openIds: ["one", "two"],
        });
    });
});

describe("shouldRefreshAllBacklinkContexts", () => {
    it("refreshes every expanded context when the target document changes", () => {
        assert.equal(shouldRefreshAllBacklinkContexts(
            new Set(["20260725000000-target"]),
            "20260725000000-target",
            "20260725000000-block",
            false,
            false,
            false,
        ), true);
    });

    it("keeps source-root changes scoped to their expanded context", () => {
        assert.equal(shouldRefreshAllBacklinkContexts(
            new Set(["20260725000000-source"]),
            "20260725000000-target",
            "20260725000000-block",
            false,
            false,
            false,
        ), false);
    });
});
