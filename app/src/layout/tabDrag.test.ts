import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    clearTabHoverSwitch,
    findNextTabId,
    reorderTabItems,
    scheduleTabHoverSwitch
} from "./tabDrag";

const createItems = () => [
    {id: "a"},
    {id: "b"},
    {id: "c"},
    {id: "d"},
];

describe("tab drag ordering", () => {
    it("uses the first surviving successor after tabs are removed", () => {
        const items = createItems();
        items.splice(1, 1);

        assert.equal(findNextTabId(items, ["b", "c", "d"]), "c");
    });

    it("moves to the end when no successor survives", () => {
        const items = createItems().slice(0, 1);

        assert.equal(findNextTabId(items, ["b", "c", "d"]), undefined);
    });

    it("moves a tab before the requested successor", () => {
        const items = createItems();

        assert.equal(reorderTabItems(items, items[3], "b"), true);
        assert.deepEqual(items.map((item) => item.id), ["a", "d", "b", "c"]);
    });

    it("moves a tab to the end when no successor exists", () => {
        const items = createItems();

        assert.equal(reorderTabItems(items, items[0]), true);
        assert.deepEqual(items.map((item) => item.id), ["b", "c", "d", "a"]);
    });

    it("does not change the list when the dragged tab is missing", () => {
        const items = createItems();

        assert.equal(reorderTabItems(items, {id: "missing"}, "b"), false);
        assert.deepEqual(items.map((item) => item.id), ["a", "b", "c", "d"]);
    });
});

describe("tab hover switching", () => {
    it("keeps the original delay when hovering the same tab", () => {
        let callback: () => void;
        let scheduleCount = 0;
        let switchCount = 0;
        const scheduler = (nextCallback: () => void): (() => void) => {
            callback = nextCallback;
            scheduleCount++;
            return () => undefined;
        };

        scheduleTabHoverSwitch("a", () => switchCount++, 500, scheduler);
        scheduleTabHoverSwitch("a", () => switchCount++, 500, scheduler);
        callback();

        assert.equal(scheduleCount, 1);
        assert.equal(switchCount, 1);
        clearTabHoverSwitch();
    });

    it("switches only the last hovered tab", () => {
        const callbacks: Array<() => void> = [];
        const switchedTabs: string[] = [];
        const scheduler = (callback: () => void): (() => void) => {
            callbacks.push(callback);
            return () => undefined;
        };

        scheduleTabHoverSwitch("a", () => switchedTabs.push("a"), 500, scheduler);
        scheduleTabHoverSwitch("b", () => switchedTabs.push("b"), 500, scheduler);
        callbacks.forEach((callback) => callback());

        assert.deepEqual(switchedTabs, ["b"]);
        clearTabHoverSwitch();
    });

    it("does not switch after clearing the hover", () => {
        let callback: () => void;
        let switchCount = 0;
        const scheduler = (nextCallback: () => void): (() => void) => {
            callback = nextCallback;
            return () => undefined;
        };

        scheduleTabHoverSwitch("a", () => switchCount++, 500, scheduler);
        clearTabHoverSwitch();
        callback();

        assert.equal(switchCount, 0);
    });
});
