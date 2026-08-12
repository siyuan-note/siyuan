import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {registerSettingGroup} from "../setting/group";
import {registerSettingItem, type RegisterSettingItem} from "../setting/item";
import {scanSettingTabSearch} from "./scan";

const registerItem = (
    tabId: string,
    id: string,
    title: string,
    searchAvailability?: () => {available: boolean; reason?: string},
) => {
    registerSettingItem({
        id,
        tabId,
        groupId: "group",
        kind: "full",
        rowParts: [{kind: "title", text: title}],
        searchTitle: title,
        searchAvailability,
    } as RegisterSettingItem);
};

describe("scanSettingTabSearch", () => {
    it("keeps an unavailable match and its reason", () => {
        const tabId = "scan-unavailable-reason";
        registerSettingGroup(tabId, "group", "Sync");
        registerItem(tabId, "sync.lan.enabled", "LAN sync", () => ({
            available: false,
            reason: "Data synchronization is not enabled",
        }));

        const result = scanSettingTabSearch(tabId, "sync", "lan");

        assert.equal(result.matches, true);
        assert.deepEqual([...result.visibleGroupIds], ["group"]);
        assert.deepEqual([...result.visibleItemIds], []);
        assert.deepEqual(result.unavailableItems?.get("sync.lan.enabled"), {
            title: "LAN sync",
            reason: "Data synchronization is not enabled",
        });
    });

    it("omits unavailable matches without a user-facing reason", () => {
        const tabId = "scan-unavailable-hidden";
        registerSettingGroup(tabId, "group", "Sync");
        registerItem(tabId, "sync.lan.enabled", "LAN sync", () => ({available: false}));

        const result = scanSettingTabSearch(tabId, "sync", "lan");

        assert.equal(result.matches, false);
        assert.deepEqual([...result.visibleGroupIds], []);
        assert.deepEqual([...result.visibleItemIds], []);
        assert.equal(result.unavailableItems?.size, 0);
    });

    it("collects every item when the tab title matches", () => {
        const tabId = "scan-tab-title";
        registerSettingGroup(tabId, "group", "Options");
        registerItem(tabId, "first", "First");
        registerItem(tabId, "second", "Second");

        const result = scanSettingTabSearch(tabId, "settings", "settings");

        assert.equal(result.matches, true);
        assert.deepEqual([...result.visibleItemIds], ["first", "second"]);
    });
});
