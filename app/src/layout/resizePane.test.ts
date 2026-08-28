import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {resizePanePercentages, splitPanePercentages} from "./resizePane";

describe("layout pane resizing", () => {
    it("keeps two panes proportional after resizing", () => {
        const percentages = resizePanePercentages([500, 500], 0, 1, 100);

        assert.deepEqual(percentages, [60, 40]);
    });

    it("only changes the panes adjacent to the divider", () => {
        const percentages = resizePanePercentages([300, 300, 400], 0, 1, 100);

        assert.deepEqual(percentages, [40, 20, 40]);
    });

    it("rejects sizes below the minimum", () => {
        const percentages = resizePanePercentages([100, 100], 0, 1, 95);

        assert.equal(percentages, undefined);
    });

    it("normalizes pane sizes before splitting an existing pane", () => {
        const percentages = splitPanePercentages([200, 300], 0, true);

        assert.deepEqual(percentages, [20, 20, 60]);
    });
});
