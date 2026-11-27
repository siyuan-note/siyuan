import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    countDocVersionDifferences,
    findPreviousHistoryTime,
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

describe("findPreviousHistoryTime", () => {
    const pages = [["90", "80"], ["70", "60"], ["50", "40"], ["30", "20"], ["10"]];
    const readPage = async (page: number) => ({histories: pages[page - 1], pageCount: pages.length});

    it("chooses the nearest older record across pages or filtered-out times", async () => {
        for (const [selected, older] of [["95", "90"], ["90", "80"], ["80", "70"], ["65", "60"],
            ["55", "50"], ["40", "30"], ["20", "10"]]) {
            assert.equal(await findPreviousHistoryTime(selected, readPage, () => true), older);
        }
    });

    it("does not invent an older version for the oldest time or an empty history", async () => {
        assert.equal(await findPreviousHistoryTime("10", readPage, () => true), undefined);
        assert.equal(await findPreviousHistoryTime("10", async () => ({histories: [], pageCount: 0}), () => true), undefined);
    });

    it("ignores a response after another history selection supersedes it", async () => {
        let current = true;
        assert.equal(await findPreviousHistoryTime("90", async (page) => {
            current = false;
            return readPage(page);
        }, () => current), undefined);
    });
});
