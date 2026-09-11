import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    canCloseTab,
    orderTabsForOverview,
    pickEvictedTabID,
    trimTabsToLimit,
} from "./mobileTabsState";

type Tab = {
    id: string;
    pin?: boolean;
    activeAt: number;
};

const createTabs = (items: Array<{ id: string; pin?: boolean; activeAt: number }>): Tab[] => items;

describe("mobile tabs state", () => {
    it("orders pinned tabs first and keeps the relative order", () => {
        const tabs = createTabs([
            {id: "a", activeAt: 1},
            {id: "b", pin: true, activeAt: 2},
            {id: "c", activeAt: 3},
            {id: "d", pin: true, activeAt: 4},
        ]);

        assert.deepEqual(orderTabsForOverview(tabs).map((tab) => tab.id), ["b", "d", "a", "c"]);
        // 不修改入参
        assert.deepEqual(tabs.map((tab) => tab.id), ["a", "b", "c", "d"]);
    });

    it("keeps the order unchanged when no tab is pinned", () => {
        const tabs = createTabs([
            {id: "a", activeAt: 1},
            {id: "b", activeAt: 2},
        ]);

        assert.deepEqual(orderTabsForOverview(tabs).map((tab) => tab.id), ["a", "b"]);
    });

    it("keeps the order unchanged when every tab is pinned", () => {
        const tabs = createTabs([
            {id: "a", pin: true, activeAt: 1},
            {id: "b", pin: true, activeAt: 2},
        ]);

        assert.deepEqual(orderTabsForOverview(tabs).map((tab) => tab.id), ["a", "b"]);
    });

    it("handles an empty tab list", () => {
        assert.deepEqual(orderTabsForOverview([]), []);
    });

    it("hides the close button of pinned tabs only when files open in the current tab", () => {
        assert.equal(canCloseTab(false, false), true);
        assert.equal(canCloseTab(false, true), true);
        assert.equal(canCloseTab(true, false), true);
        assert.equal(canCloseTab(true, true), false);
    });

    it("never evicts pinned tabs or the active tab", () => {
        const tabs = createTabs([
            {id: "oldest", activeAt: 1},
            {id: "pinned", pin: true, activeAt: 2},
            {id: "active", activeAt: 3},
            {id: "newest", activeAt: 4},
        ]);

        assert.equal(pickEvictedTabID(tabs, "active"), "oldest");
    });

    it("evicts the least recently active unpinned tab", () => {
        const tabs = createTabs([
            {id: "a", activeAt: 30},
            {id: "b", pin: true, activeAt: 10},
            {id: "c", activeAt: 20},
            {id: "d", activeAt: 40},
        ]);

        assert.equal(pickEvictedTabID(tabs, "d"), "c");
        assert.equal(pickEvictedTabID(tabs, undefined), "c");
    });

    it("keeps every pinned tab when all of them are pinned", () => {
        const tabs = createTabs([
            {id: "a", pin: true, activeAt: 1},
            {id: "b", pin: true, activeAt: 2},
            {id: "c", pin: true, activeAt: 3},
        ]);

        assert.equal(pickEvictedTabID(tabs, "c"), undefined);
    });

    it("removes the oldest unpinned tabs until the limit is reached", () => {
        const removed: string[] = [];
        const remaining = trimTabsToLimit(createTabs([
            {id: "a", activeAt: 1},
            {id: "b", activeAt: 2},
            {id: "c", activeAt: 3},
            {id: "d", activeAt: 4},
        ]), "d", 2, (tab) => removed.push(tab.id));

        assert.deepEqual(remaining.map((tab) => tab.id), ["c", "d"]);
        assert.deepEqual(removed, ["a", "b"]);
    });

    it("allows exceeding the limit instead of evicting pinned tabs", () => {
        const removed: string[] = [];
        const remaining = trimTabsToLimit(createTabs([
            {id: "pinnedA", pin: true, activeAt: 1},
            {id: "pinnedB", pin: true, activeAt: 2},
            {id: "active", activeAt: 3},
            {id: "unpinned", activeAt: 4},
        ]), "active", 2, (tab) => removed.push(tab.id));

        // 上限为 2，钉住页签占满后不再淘汰，允许超出上限
        assert.deepEqual(remaining.map((tab) => tab.id), ["pinnedA", "pinnedB", "active"]);
        assert.deepEqual(removed, ["unpinned"]);
    });

    it("keeps the tab list untouched when it is within the limit", () => {
        const tabs = createTabs([
            {id: "a", pin: true, activeAt: 1},
            {id: "b", activeAt: 2},
        ]);
        const removed: string[] = [];

        assert.deepEqual(trimTabsToLimit(tabs, "b", 8, (tab) => removed.push(tab.id)), tabs);
        assert.deepEqual(removed, []);
    });
});
