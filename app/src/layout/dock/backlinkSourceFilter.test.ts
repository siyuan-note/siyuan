import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    createBacklinkSourceFilter,
    getBacklinkSourceFilterParam,
    normalizeBacklinkSourceFilter
} from "./backlinkSourceFilter";

describe("backlink source filter", () => {
    it("keeps membership-only database filters active and clones their conditions", () => {
        const source = {...createBacklinkSourceFilter(), database: {avID: "database", filters: [] as IAVFilter[]}};
        const normalized = getBacklinkSourceFilterParam(source);
        assert.equal(normalized.database.avID, "database");
        normalized.database.filters.push({column: "field", operator: "Is empty", value: {type: "text"}});
        assert.equal(source.database.filters.length, 0);
        delete source.database;
        assert.equal(getBacklinkSourceFilterParam(source), undefined);
    });
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
            excludedRefDefIDs: [],
        });
    });

    it("keeps reference-only filters and normalizes IDs", () => {
        const id = "20260909120000-abcdefg";
        const filter = getBacklinkSourceFilterParam({
            ...createBacklinkSourceFilter(), excludedRefDefIDs: [id, "", "invalid", id],
        });
        assert.deepEqual(filter.excludedRefDefIDs, [id]);
    });
});
