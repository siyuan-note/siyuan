import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {pairSnapshotFilesByPath} from "./snapshotDiffCore";

describe("pairSnapshotFilesByPath", () => {
    it("pairs updated files by path when one side contains an unmatched file", () => {
        const left = [
            {path: "/data/a.sy", id: "left-a"},
            {path: "/data/b.sy", id: "left-b"},
        ];
        const right = [
            {path: "/data/missing.sy", id: "right-missing"},
            {path: "/data/b.sy", id: "right-b"},
            {path: "\\data\\a.sy", id: "right-a"},
        ];

        const paired = pairSnapshotFilesByPath(left, right);

        assert.equal(paired[0].compareFile?.id, "right-a");
        assert.equal(paired[1].compareFile?.id, "right-b");
    });
});
