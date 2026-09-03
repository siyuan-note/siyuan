import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    BAZAAR_CARD_BATCH_SIZE,
    filterBazaarPackagesByThemeMode,
    getNextBazaarCardBatch,
} from "./batchRenderer";

describe("bazaar card batch renderer", () => {
    it("returns fixed batches without duplicates or omissions", () => {
        const packages = Array.from({length: BAZAAR_CARD_BATCH_SIZE * 2 + 3}, (_, index) => index);
        const first = getNextBazaarCardBatch(packages, 0);
        const second = getNextBazaarCardBatch(packages, first.nextCursor);
        const last = getNextBazaarCardBatch(packages, second.nextCursor);

        assert.equal(first.complete, false);
        assert.equal(second.complete, false);
        assert.equal(last.complete, true);
        assert.deepEqual([...first.packages, ...second.packages, ...last.packages], packages);
    });

    it("handles empty and completed package lists", () => {
        assert.deepEqual(getNextBazaarCardBatch([], 0), {
            packages: [],
            nextCursor: 0,
            complete: true,
        });
        assert.deepEqual(getNextBazaarCardBatch([1, 2], 2), {
            packages: [],
            nextCursor: 2,
            complete: true,
        });
    });

    it("filters themes by supported mode and keeps dual-mode themes", () => {
        const packages = [
            {name: "light", modes: ["light"]},
            {name: "dark", modes: ["dark"]},
            {name: "both", modes: ["light", "dark"]},
            {name: "missing"},
        ];

        assert.deepEqual(filterBazaarPackagesByThemeMode(packages, "themes", "0").map((item) => item.name), [
            "light", "both", "missing",
        ]);
        assert.deepEqual(filterBazaarPackagesByThemeMode(packages, "themes", "1").map((item) => item.name), [
            "dark", "both", "missing",
        ]);
        assert.equal(filterBazaarPackagesByThemeMode(packages, "plugins", "0"), packages);
        assert.equal(filterBazaarPackagesByThemeMode(packages, "themes", "2"), packages);
        assert.equal(filterBazaarPackagesByThemeMode(packages, "themes", "unknown"), packages);
    });
});
