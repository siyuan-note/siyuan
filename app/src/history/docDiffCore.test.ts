import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    countDocVersionDifferences,
    type IDocVersionDifference,
    type IDocVersionRef,
    matchesDocVersionDiffFilter,
    orderDocVersionRefs,
} from "./docDiffCore";

const version = (label: string, created: number): IDocVersionRef => ({
    type: "snapshot",
    id: label,
    label,
    created,
});

describe("orderDocVersionRefs", () => {
    it("orders the older version before the newer version", () => {
        const older = version("older", 1);
        const newer = version("newer", 2);

        assert.deepEqual(orderDocVersionRefs(newer, older), [older, newer]);
        assert.deepEqual(orderDocVersionRefs(older, newer), [older, newer]);
    });
});

describe("document version difference filters", () => {
    const differences: IDocVersionDifference[] = [
        {id: "added", statuses: ["right-only"]},
        {id: "removed", statuses: ["left-only"]},
        {id: "modified", statuses: ["modified"]},
        {id: "moved", statuses: ["moved"]},
        {id: "modified-and-moved", statuses: ["modified", "moved"]},
    ];

    it("maps directional statuses to user-facing filters", () => {
        assert.equal(matchesDocVersionDiffFilter(differences[0], "added"), true);
        assert.equal(matchesDocVersionDiffFilter(differences[1], "removed"), true);
        assert.equal(matchesDocVersionDiffFilter(differences[2], "modified"), true);
        assert.equal(matchesDocVersionDiffFilter(differences[3], "modified"), true);
        assert.equal(matchesDocVersionDiffFilter(differences[0], "removed"), false);
    });

    it("counts each filter without double-counting moved modifications", () => {
        assert.deepEqual(countDocVersionDifferences(differences), {
            all: 5,
            added: 1,
            removed: 1,
            modified: 3,
        });
    });
});
