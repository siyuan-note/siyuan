import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getHeadingLevelUpdateOperations} from "./headingTransform";

describe("getHeadingLevelUpdateOperations", () => {
    it("keeps heading updates out of a compound unfold transaction", () => {
        const operations = [
            {action: "unfoldHeading", id: "heading-1"},
            {action: "update", id: "heading-1", data: "parent"},
            {action: "update", id: "heading-2", data: "child"},
            {action: "foldHeading", id: "heading-1"},
        ] as IOperation[];

        assert.deepEqual(getHeadingLevelUpdateOperations(operations).map(operation => operation.id),
            ["heading-1", "heading-2"]);
        assert.deepEqual(getHeadingLevelUpdateOperations(operations, new Set(["heading-1"])).map(operation => operation.id),
            ["heading-2"]);
    });
});
