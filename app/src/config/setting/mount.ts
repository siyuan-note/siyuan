import {buildGroupedItemsView} from "../render/render";
import {getSearchKeywordsLower, normalizeSearchText} from "../search/normalize";
import {Constants} from "../../constants";
import type {SettingSearchUnavailableItem, SettingTabMountContext} from "./builder";
import {getSettingTab, type TSettingTab} from "./tabs";

/** 首次挂载：渲染全部注册项并执行 afterMount */
export const mountSettingTab = async (tabId: string, root: HTMLElement) => {
    const {html, items} = buildGroupedItemsView(tabId);
    root.innerHTML = html;

    for (const item of items) {
        await item.afterMount?.(root);
    }
};

/** 设置面板已打开且对应 Tab 已挂载时，重新 register 并整页替换 */
export const remountOpenSettingTab = async (tabId: TSettingTab) => {
    const dialogElement = window.siyuan.dialogs.find((d) => d.element.getAttribute("data-key") === Constants.DIALOG_SETTING)?.element;
    if (!dialogElement) {
        return;
    }
    const root = dialogElement.querySelector(`.config__tab-container[data-name="${tabId}"]`) as HTMLElement | null;
    if (!root?.innerHTML) {
        return;
    }
    const search: Partial<SettingTabMountContext> = {};
    const keywords = getSearchKeywordsLower(dialogElement);
    const tab = getSettingTab(tabId);
    if (keywords) {
        const result = tab.scanSearch(keywords);
        search.keywords = keywords;
        search.visibleItemIds = result.visibleItemIds;
        search.visibleGroupIds = result.visibleGroupIds;
        search.unavailableItems = result.unavailableItems;
    }
    await tab.mount(root, search, undefined, true);
};

export const applySettingTabSearchVisibility = (
    root: HTMLElement,
    visibleItemIds: Set<string>,
    visibleGroupIds: Set<string>,
    unavailableItems?: Map<string, SettingSearchUnavailableItem>,
) => {
    root.querySelectorAll("[data-config-search-unavailable-id]").forEach((element) => element.remove());
    root.querySelectorAll("[data-config-group-id]").forEach((groupEl) => {
        const groupId = groupEl.getAttribute("data-config-group-id");
        const groupVisible = groupId && visibleGroupIds.has(groupId);
        groupEl.classList.toggle("config-search-hidden", !groupVisible);
        if (!groupVisible) {
            return;
        }

        let lastVisibleItem: Element | null = null;
        groupEl.querySelectorAll("[data-config-item-id]").forEach((itemEl) => {
            itemEl.classList.remove("config-item--last-visible");
            const itemId = itemEl.getAttribute("data-config-item-id");
            const unavailableItem = itemId ? unavailableItems?.get(itemId) : undefined;
            const itemVisible = itemId && visibleItemIds.has(itemId) && !unavailableItem;
            itemEl.classList.toggle("config-search-hidden", !itemVisible);
            if (itemVisible) {
                lastVisibleItem = itemEl;
            } else if (itemId && unavailableItem) {
                const unavailableElement = document.createElement("div");
                unavailableElement.className = "fn__flex b3-label config-item";
                unavailableElement.dataset.configSearchUnavailableId = itemId;
                const mainElement = document.createElement("div");
                mainElement.className = "fn__flex-1 config-item__main";
                const titleElement = document.createElement("div");
                titleElement.className = "config-name";
                titleElement.innerHTML = unavailableItem.title;
                const reasonElement = document.createElement("div");
                reasonElement.className = "b3-label__text";
                reasonElement.textContent = unavailableItem.reason;
                mainElement.append(titleElement, reasonElement);
                unavailableElement.append(mainElement);
                itemEl.after(unavailableElement);
                lastVisibleItem = unavailableElement;
            }
        });
        // 标记每组最后一个未隐藏条目，不显示 border-bottom
        lastVisibleItem?.classList.add("config-item--last-visible");
    });
};

export const clearSettingTabSearch = (root: HTMLElement) => {
    root.querySelectorAll("[data-config-search-unavailable-id]").forEach((element) => element.remove());
    root.querySelectorAll("[data-config-group-id], [data-config-item-id]").forEach((el) => {
        el.classList.remove("config-search-hidden", "config-item--last-visible");
    });
};

/** 面板型 SettingTab：根据全局搜索关键词切换 layout-tab-bar 子 Tab */
export const switchSettingPanelSubTab = (
    root: HTMLElement,
    keywords: string,
    subTabs: {type: string; label: string}[],
) => {
    const focusedType = root.querySelector(".layout-tab-bar .item--focus")?.getAttribute("data-type");
    const focusedTab = subTabs.find((t) => t.type === focusedType);
    if (focusedTab && normalizeSearchText(focusedTab.label).includes(keywords)) {
        return;
    }
    for (const tab of subTabs) {
        if (!normalizeSearchText(tab.label).includes(keywords)) {
            continue;
        }
        const tabItem = root.querySelector(`.layout-tab-bar .item[data-type="${tab.type}"]`) as HTMLElement | null;
        if (tabItem && !tabItem.classList.contains("item--focus")) {
            tabItem.click();
        }
        break;
    }
};
