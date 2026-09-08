import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getAVAssetUploadTargets} from "./assetUploadTarget";
import type {IAVSelectedCell} from "./selectionState";

describe("database asset upload targets", () => {
    it("uses the complete logical selection instead of a partial rendered selection", () => {
        const stableCells = ["row-a", "row-b", "row-c"].map(rowID => ({rowID} as IAVSelectedCell));
        const renderedCells = [{dataset: {rowId: "row-c"}}] as unknown as HTMLElement[];

        const targets = getAVAssetUploadTargets(stableCells, renderedCells);

        assert.deepEqual(targets.map(target => target.stableCell?.rowID), ["row-a", "row-b", "row-c"]);
        assert.equal(targets.some(target => target.cellElement), false);
    });

    it("uses rendered cells when no logical selection is available", () => {
        const renderedCells = [{dataset: {rowId: "row-a"}}] as unknown as HTMLElement[];

        const targets = getAVAssetUploadTargets([], renderedCells);

        assert.equal(targets[0].cellElement, renderedCells[0]);
        assert.equal(targets[0].stableCell, undefined);
    });
});
