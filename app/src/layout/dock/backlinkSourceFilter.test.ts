import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    createBacklinkSourceFilter,
    getBacklinkSourceFilterParam,
    normalizeBacklinkSourceFilter
} from "./backlinkSourceFilter";

describe("backlink source filter", () => {
    it("omits the default filter", () => {
        assert.equal(getBacklinkSourceFilterParam(createBacklinkSourceFilter()), undefined);
    });

    it("normalizes notebook IDs", () => {
        assert.deepEqual(normalizeBacklinkSourceFilter({
            dailyNote: "only",
            excludedNotebookIDs: ["box-b", "", "box-a", "box-b"],
            excludeSelf: true,
        }), {
            dailyNote: "only",
            excludedNotebookIDs: ["box-a", "box-b"],
            excludeSelf: true,
        });
    });
});
