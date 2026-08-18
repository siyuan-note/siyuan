import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {countFilterLeaves, isFilterGroup} from "./filterTree";

describe("database filter tree helpers", () => {
    it("recognizes groups whose empty filters are omitted during serialization", () => {
        const root = {combination: "and"} as IAVFilter;

        assert.equal(isFilterGroup(root), true);
        assert.equal(countFilterLeaves([root]), 0);
    });

    it("does not count explicitly empty groups as leaves", () => {
        assert.equal(countFilterLeaves([{combination: "and", filters: []}]), 0);
    });

    it("counts ordinary and legacy flat leaves", () => {
        const filters = [
            {column: "column-a", operator: "Is empty"},
            {column: "column-b", operator: "Is not empty"},
        ] as IAVFilter[];

        assert.equal(countFilterLeaves(filters), 2);
    });

    it("counts only real leaves in nested groups", () => {
        const filters = [{
            combination: "and",
            filters: [
                {column: "column-a", operator: "Is empty"},
                {
                    combination: "or",
                    filters: [
                        {column: "column-b", operator: "Is not empty"},
                        {combination: "and"},
                    ],
                },
            ],
        }] as IAVFilter[];

        assert.equal(countFilterLeaves(filters), 2);
    });
});
