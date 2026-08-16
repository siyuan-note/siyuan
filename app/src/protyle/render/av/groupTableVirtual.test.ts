import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    clampGroupTableVirtualData,
    getGroupTableRenderPlan,
    getGroupTableViewportWindow,
    getUninitializedGroupRowCounts,
} from "./groupTableVirtual";

const createGroup = (id: string, rowCount: number, options: {
    folded?: boolean;
    hidden?: number;
} = {}) => ({
    id,
    rows: Array.from({length: rowCount}, (_, index) => ({id: `${id}-row-${index}`})),
    groupFolded: options.folded || false,
    groupHidden: options.hidden || 0,
}) as IAVTable;

describe("grouped table initial render planning", () => {
    it("renders every visible expanded row when the total is within budget", () => {
        const plan = getGroupTableRenderPlan([
            createGroup("visible", 4),
            createGroup("folded", 5, {folded: true}),
            createGroup("hidden", 6, {hidden: 1}),
        ], {}, 10);

        assert.equal(plan.virtualized, false);
        assert.deepEqual(plan.virtualData, {});
        assert.deepEqual(plan.renderedRowCounts, {visible: 4});
    });

    it("shares the budget across many groups without starving a group", () => {
        const groups = Array.from({length: 44}, (_, index) => createGroup(`group-${index}`, index === 43 ? 34 : 20));
        const plan = getGroupTableRenderPlan(groups, {}, 100);

        assert.equal(plan.virtualized, true);
        assert.equal(Object.values(plan.renderedRowCounts).reduce((sum, count) => sum + count, 0), 100);
        assert.equal(Object.values(plan.renderedRowCounts).every(count => count >= 1), true);
        assert.equal(plan.renderedRowCounts["group-0"], 20);
        assert.equal(plan.renderedRowCounts["group-1"], 20);
        assert.equal(plan.renderedRowCounts["group-2"], 19);
        assert.equal(plan.renderedRowCounts["group-3"], 1);
        assert.equal(plan.renderedRowCounts["group-43"], 1);
    });

    it("prioritizes one row per group when group count exceeds the nominal budget", () => {
        const groups = Array.from({length: 120}, (_, index) => createGroup(`group-${index}`, 2));
        const plan = getGroupTableRenderPlan(groups, {}, 100);

        assert.equal(Object.values(plan.renderedRowCounts).reduce((sum, count) => sum + count, 0), 120);
        assert.equal(Object.values(plan.renderedRowCounts).every(count => count === 1), true);
    });

    it("preserves restored windows and includes only a folded locate target", () => {
        const restored = {
            expanded: {renderedStart: 5, renderedEnd: 9, topSpacerHeight: 180},
            target: {renderedStart: 10, renderedEnd: 14, topSpacerHeight: 360, locate: true},
        } as Record<string, IAVVirtualData>;
        const plan = getGroupTableRenderPlan([
            createGroup("expanded", 20),
            createGroup("target", 20, {folded: true}),
            createGroup("folded", 20, {folded: true}),
        ], restored, 10);

        assert.deepEqual(plan.virtualData.expanded, restored.expanded);
        assert.deepEqual(plan.virtualData.target, restored.target);
        assert.equal(plan.renderedRowCounts.expanded, 5);
        assert.equal(plan.renderedRowCounts.target, 5);
        assert.equal(plan.renderedRowCounts.folded, undefined);
    });
});

describe("grouped table virtual window clamping", () => {
    it("resets a stale deep window after search shrinks the rows", () => {
        assert.deepEqual(clampGroupTableVirtualData({
            renderedStart: 90,
            renderedEnd: 99,
            topSpacerHeight: 3240,
        }, 3), {
            renderedStart: 0,
            renderedEnd: 2,
            topSpacerHeight: 0,
        });
    });

    it("clamps both bounds and clears an invalid top spacer", () => {
        assert.deepEqual(clampGroupTableVirtualData({
            renderedStart: -2,
            renderedEnd: 20,
            topSpacerHeight: 72,
        }, 5), {
            renderedStart: 0,
            renderedEnd: 4,
            topSpacerHeight: 0,
        });
        assert.equal(clampGroupTableVirtualData(undefined, 5), undefined);
        assert.equal(clampGroupTableVirtualData({
            renderedStart: 0,
            renderedEnd: 1,
            topSpacerHeight: 0,
        }, 0), undefined);
    });
});

describe("grouped table viewport window rebuilding", () => {
    it("rebuilds a three-viewport window around a middle spacer position", () => {
        assert.deepEqual(getGroupTableViewportWindow({
            dataStart: 0,
            dataEnd: 99,
            bodyTop: 100,
            headerHeight: 40,
            viewportTop: 1760,
            viewportBottom: 2120,
            rowHeight: 36,
        }), {
            renderedStart: 40,
            renderedEnd: 69,
            topSpacerHeight: 1440,
            targetIndex: 50,
        });
    });

    it("clamps the rebuilt window at both ends", () => {
        assert.deepEqual(getGroupTableViewportWindow({
            dataStart: 400,
            dataEnd: 499,
            bodyTop: 100,
            headerHeight: 40,
            viewportTop: 100,
            viewportBottom: 460,
            rowHeight: 36,
        }), {
            renderedStart: 400,
            renderedEnd: 429,
            topSpacerHeight: 0,
            targetIndex: 403,
        });
        assert.deepEqual(getGroupTableViewportWindow({
            dataStart: 400,
            dataEnd: 499,
            bodyTop: 100,
            headerHeight: 40,
            viewportTop: 3700,
            viewportBottom: 4060,
            rowHeight: 36,
        }), {
            renderedStart: 470,
            renderedEnd: 499,
            topSpacerHeight: 2520,
            targetIndex: 499,
        });
    });

    it("handles empty data and invalid row height", () => {
        assert.equal(getGroupTableViewportWindow({
            dataStart: 0,
            dataEnd: -1,
            bodyTop: 0,
            headerHeight: 0,
            viewportTop: 0,
            viewportBottom: 100,
            rowHeight: 0,
        }), undefined);
        const window = getGroupTableViewportWindow({
            dataStart: 0,
            dataEnd: 9,
            bodyTop: 0,
            headerHeight: 0,
            viewportTop: 0,
            viewportBottom: 0,
            rowHeight: 0,
        });
        assert.deepEqual(window, {
            renderedStart: 0,
            renderedEnd: 2,
            topSpacerHeight: 0,
            targetIndex: 0,
        });
    });
});

describe("grouped table deferred body initialization", () => {
    it("uses the remaining budget after initialized bodies", () => {
        assert.deepEqual(getUninitializedGroupRowCounts([
            createGroup("first", 20),
            createGroup("second", 20),
        ], 90, 100), {
            first: 9,
            second: 1,
        });
    });

    it("renders complete bodies when all loaded rows fit", () => {
        assert.deepEqual(getUninitializedGroupRowCounts([
            createGroup("first", 3),
            createGroup("second", 4),
        ], 2, 10), {
            first: 3,
            second: 4,
        });
    });

    it("still makes every newly expanded group addressable after the budget is exhausted", () => {
        assert.deepEqual(getUninitializedGroupRowCounts([
            createGroup("first", 20),
            createGroup("second", 20),
        ], 100, 100), {
            first: 1,
            second: 1,
        });
    });
});
