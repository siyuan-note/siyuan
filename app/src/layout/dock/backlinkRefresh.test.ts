import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {shouldForceBacklinkRefresh} from "./backlinkRefresh";

describe("shouldForceBacklinkRefresh", () => {
    it("refreshes reference changes in the owner document while it is focused", () => {
        assert.equal(shouldForceBacklinkRefresh("owner", "owner"), true);
    });

    it("keeps unrelated document changes deferred", () => {
        assert.equal(shouldForceBacklinkRefresh("owner", "other"), false);
        assert.equal(shouldForceBacklinkRefresh("", "other"), false);
    });
});
