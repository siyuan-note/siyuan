import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {MIN_HORIZONTAL_PANE_SIZE, MIN_VERTICAL_PANE_SIZE, resizePanePercentages, splitPanePercentages} from "./resizePane";

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

    it("keeps horizontal panes usable without resizing other panes", () => {
        const left = resizePanePercentages([400, 400, 200], 0, 1, -1000, MIN_HORIZONTAL_PANE_SIZE);
        const right = resizePanePercentages([400, 400, 200], 0, 1, 1000, MIN_HORIZONTAL_PANE_SIZE);
        [24, 56, 20].forEach((expected, index) => assert.ok(Math.abs(left[index] - expected) < 1e-10));
        [56, 24, 20].forEach((expected, index) => assert.ok(Math.abs(right[index] - expected) < 1e-10));
    });

    it("allows a narrow horizontal pane to widen without forcing the layout to jump", () => {
        assert.deepEqual(resizePanePercentages([100, 400], 0, 1, -50, MIN_HORIZONTAL_PANE_SIZE), [20, 80]);
        assert.deepEqual(resizePanePercentages([100, 400], 0, 1, 100, MIN_HORIZONTAL_PANE_SIZE), [40, 60]);
        assert.deepEqual(resizePanePercentages([100, 100], 0, 1, 50, MIN_HORIZONTAL_PANE_SIZE), [50, 50]);
    });

    it("normalizes pane sizes before splitting an existing pane", () => {
        const percentages = splitPanePercentages([200, 300], 0, true);

        assert.deepEqual(percentages, [20, 20, 60]);
    });
});
