import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    canCloseTab,
    moveTab,
    orderTabsForOverview,
    pickEvictedTabID,
    trimTabsToLimit,
    toggleTabPin,
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

    it("always hides the close button of pinned tabs", () => {
        assert.equal(canCloseTab(false), true);
        assert.equal(canCloseTab(true), false);
    });

    it("places toggled tabs at the group boundary and preserves the order after restoring", () => {
        const tabs = createTabs([
            {id: "a", activeAt: 1},
            {id: "b", activeAt: 2},
            {id: "c", activeAt: 3},
            {id: "d", activeAt: 4},
        ]);
        let result = toggleTabPin(toggleTabPin(tabs, "d"), "b");
        assert.deepEqual(result.map((tab) => tab.id), ["d", "b", "a", "c"]);
        result = toggleTabPin(result, "d");
        assert.deepEqual(result.map((tab) => tab.id), ["b", "d", "a", "c"]);
        assert.deepEqual(orderTabsForOverview(JSON.parse(JSON.stringify(result))), result);
        assert.equal(result.find((tab) => tab.id === "d").activeAt, 4);
        assert.equal(tabs[3].pin, undefined);
    });

    it("reorders both groups without crossing the pinned boundary", () => {
        const tabs = createTabs([
            {id: "a", pin: true, activeAt: 1},
            {id: "b", pin: true, activeAt: 2},
            {id: "c", activeAt: 3},
            {id: "d", activeAt: 4},
        ]);
        let result = moveTab(tabs, "a", "b", true);
        result = moveTab(result, "d", "c", false);
        assert.deepEqual(result.map((tab) => tab.id), ["b", "a", "d", "c"]);
        assert.deepEqual(moveTab(result, "a", "d", true), result);
        assert.deepEqual(moveTab(result, "d", "a", false), result);
        assert.deepEqual(moveTab(result, "missing", "a", false), result);
        assert.deepEqual(moveTab(result, "a", "a", false), result);
        assert.deepEqual(tabs.map((tab) => tab.id), ["a", "b", "c", "d"]);
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
