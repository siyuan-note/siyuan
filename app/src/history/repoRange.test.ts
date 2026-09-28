import * as assert from "node:assert/strict";
import test from "node:test";
import {repoDateRange, repoSnapshotInRange} from "./repoRange";

test("snapshot date ranges include both selected local dates and handle daylight saving", () => {
    const original = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
        assert.deepEqual(repoDateRange("", ""), {});
        const range = repoDateRange("2026-03-08", "2026-03-08");
        assert.equal(range.endTime - range.startTime, 23 * 3600000);
        assert.equal(repoSnapshotInRange(range.startTime - 1, range), false);
        assert.equal(repoSnapshotInRange(range.startTime, range), true);
        assert.equal(repoSnapshotInRange(range.endTime - 1, range), true);
        assert.equal(repoSnapshotInRange(range.endTime, range), false);
        assert.equal(repoSnapshotInRange(1, repoDateRange("", "2026-03-08")), true);
        assert.equal(repoSnapshotInRange(range.endTime + 1, repoDateRange("2026-03-08", "")), true);
    } finally {
        if (original === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = original;
        }
    }
});
