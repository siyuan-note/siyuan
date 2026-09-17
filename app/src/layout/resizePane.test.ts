import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {MIN_VERTICAL_PANE_SIZE, resizePanePercentages, splitPanePercentages} from "./resizePane";

describe("layout pane resizing", () => {
    it("keeps two panes proportional after resizing", () => {
        const percentages = resizePanePercentages([500, 500], 0, 1, 100);

        assert.deepEqual(percentages, [60, 40]);
    });

    it("only changes the panes adjacent to the divider", () => {
        const percentages = resizePanePercentages([300, 300, 400], 0, 1, 100);

        assert.deepEqual(percentages, [40, 20, 40]);
    });

    it("clamps sizes at the minimum", () => {
        const percentages = resizePanePercentages([100, 100], 0, 1, 95);

        assert.deepEqual(percentages, [96, 4]);
    });

    it("keeps vertical panes usable when dragged past either edge", () => {
        assert.deepEqual(resizePanePercentages([400, 400], 0, 1, -1000, MIN_VERTICAL_PANE_SIZE), [25, 75]);
        assert.deepEqual(resizePanePercentages([400, 400], 0, 1, 1000, MIN_VERTICAL_PANE_SIZE), [75, 25]);
    });

    it("allows an undersized pane to recover without shrinking it further", () => {
        assert.deepEqual(resizePanePercentages([100, 400], 0, 1, -50, MIN_VERTICAL_PANE_SIZE), [20, 80]);
        assert.deepEqual(resizePanePercentages([100, 400], 0, 1, 100, MIN_VERTICAL_PANE_SIZE), [40, 60]);
    });

    it("normalizes pane sizes before splitting an existing pane", () => {
        const percentages = splitPanePercentages([200, 300], 0, true);

        assert.deepEqual(percentages, [20, 20, 60]);
    });
});
