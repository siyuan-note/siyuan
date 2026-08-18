import assert from "node:assert/strict";
import test from "node:test";
import {mergeAVBatchRelationValue} from "../src/protyle/render/av/batchValue";

const relationValue = (blockIDs: string[]): IAVCellRelationValue => ({
    blockIDs,
    contents: blockIDs.map(itemID => ({
        type: "block",
        block: {
            id: itemID,
            content: itemID,
        }
    }))
});

test("adds only the relation introduced by the current batch edit", () => {
    const result = mergeAVBatchRelationValue(
        relationValue(["original", "previous"]),
        relationValue(["previous"]),
        relationValue(["previous", "added"]),
        "add"
    );

    assert.deepEqual(result.blockIDs, ["original", "previous", "added"]);
    assert.deepEqual(result.contents?.map(item => item.block.id), ["original", "previous", "added"]);
});

test("removes only the relation cleared by the current batch edit", () => {
    const result = mergeAVBatchRelationValue(
        relationValue(["kept-by-row", "removed"]),
        relationValue(["kept-by-display", "removed"]),
        relationValue(["kept-by-display"]),
        "remove"
    );

    assert.deepEqual(result.blockIDs, ["kept-by-row"]);
    assert.deepEqual(result.contents?.map(item => item.block.id), ["kept-by-row"]);
});
