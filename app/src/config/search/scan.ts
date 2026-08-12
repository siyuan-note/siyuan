import {SettingTabSearchResult} from "../setting/builder";
import {getTabGroupEntries, type MountableSettingItem} from "../setting/item";

/** 一次遍历 SettingTab 的 Group / Item，同时得到侧栏命中与内容区可见性 */
export const scanSettingTabSearch = (
    tabId: string,
    tabSearchTitle: string,
    keywords: string,
): SettingTabSearchResult => {
    const visibleItemIds = new Set<string>();
    const visibleGroupIds = new Set<string>();
    const unavailableItems = new Map<string, {title: string; reason: string}>();

    const addItem = (item: MountableSettingItem) => {
        const availability = item.searchAvailability?.();
        if (availability?.available === false) {
            if (availability.reason && item.searchTitle) {
                unavailableItems.set(item.id, {title: item.searchTitle, reason: availability.reason});
                return true;
            }
            return false;
        }
        visibleItemIds.add(item.id);
        return true;
    };

    if (tabSearchTitle.length > 0 && tabSearchTitle.includes(keywords)) {
        // 匹配标签页标题
        for (const {group, items} of getTabGroupEntries(tabId)) {
            let groupVisible = false;
            for (const item of items) {
                if (addItem(item)) {
                    groupVisible = true;
                }
            }
            if (groupVisible) {
                visibleGroupIds.add(group.id);
            }
        }
        const matches = visibleGroupIds.size > 0;
        return {matches, visibleItemIds, visibleGroupIds, unavailableItems};
    }

    let matches = false;
    for (const {group, items} of getTabGroupEntries(tabId)) {
        if (group.searchTitle.length > 0 && group.searchTitle.includes(keywords)) {
            // 匹配分组标题
            let groupVisible = false;
            for (const item of items) {
                if (addItem(item)) {
                    groupVisible = true;
                }
            }
            if (groupVisible) {
                matches = true;
                visibleGroupIds.add(group.id);
            }
            continue;
        }
        for (const item of items) {
            if (item.searchIndex.some((s) => s.includes(keywords))) {
                // 匹配设置项文案
                if (addItem(item)) {
                    matches = true;
                    visibleGroupIds.add(group.id);
                }
            }
        }
    }
    return {matches, visibleItemIds, visibleGroupIds, unavailableItems};
};
