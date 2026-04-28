import {SettingTabSearchResult} from "../setting/builder";
import {getTabGroupEntries} from "../setting/item";

/** 一次遍历 SettingTab 的 Group / Item，同时得到侧栏命中与内容区可见性 */
export const scanSettingTabSearch = (
    tabId: string,
    tabSearchTitle: string,
    keywords: string,
): SettingTabSearchResult => {
    const visibleItemIds = new Set<string>();
    const visibleGroupIds = new Set<string>();

    if (tabSearchTitle.length > 0 && tabSearchTitle.includes(keywords)) {
        // 匹配标签页标题
        for (const {group, items} of getTabGroupEntries(tabId)) {
            visibleGroupIds.add(group.id);
            for (const item of items) {
                visibleItemIds.add(item.id);
            }
        }
        return {matches: true, visibleItemIds, visibleGroupIds};
    }

    let matches = false;
    for (const {group, items} of getTabGroupEntries(tabId)) {
        if (group.searchTitle.length > 0 && group.searchTitle.includes(keywords)) {
            // 匹配分组标题
            matches = true;
            visibleGroupIds.add(group.id);
            for (const item of items) {
                visibleItemIds.add(item.id);
            }
            continue;
        }
        for (const item of items) {
            if (item.searchIndex.some((s) => s.includes(keywords))) {
                // 匹配设置项文案
                matches = true;
                visibleItemIds.add(item.id);
                visibleGroupIds.add(group.id);
            }
        }
    }
    return {matches, visibleItemIds, visibleGroupIds};
};
