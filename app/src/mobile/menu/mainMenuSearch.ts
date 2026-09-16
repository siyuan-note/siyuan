import type {App} from "../../index";
import {getSettingTab, type TSettingTab} from "../../config/setting/tabs";
import {bindSettingSaveDelegation} from "../../config/setting/save";
import {normalizeSearchText} from "../../config/search/normalize";
import type {SettingTabSearchResult} from "../../config/setting/builder";
import {isMobileMenuSearchMatch} from "./searchFilter";
import {getSettingTabFromMenuTarget} from "./mainMenu";
import {unmountSettingTab} from "./settingPanel";
import {activeBlur} from "../util/keyboardToolbar";

export interface IMainMenuSearch {
    /** 搜索框当前关键字，已归一化；空串表示未处于搜索态 */
    keywords: () => string;
    sync: () => void;
    reset: (preserveKeyboard?: boolean) => void;
    /** 搜索态下就地展开指定设置页；返回 false 表示该设置页无匹配，调用方应终止本次点击 */
    selectSettingTab: (tabId: TSettingTab) => boolean;
}

const clearSettingTabResult = (root: HTMLElement) => {
    const tabId = root.dataset.name as TSettingTab;
    unmountSettingTab(root, tabId);
    const replacement = document.createElement("div");
    replacement.className = "config mobile-setting-menu__result fn__none";
    replacement.dataset.name = tabId;
    root.replaceWith(replacement);
};

const clearSettingTabResults = (element: HTMLElement) => {
    element.querySelectorAll<HTMLElement>(".mobile-setting-menu__result").forEach((root) => {
        if (root.childElementCount > 0 || !root.classList.contains("fn__none")) {
            clearSettingTabResult(root);
        }
    });
    element.querySelectorAll('[data-type="setting-tab"]').forEach((item) => {
        item.classList.remove("b3-menu__item--current");
    });
};

/** 串行挂载设置页搜索结果，仅允许最后一次请求写入 DOM */
const createSettingSearchMountQueue = (app: App) => {
    let version = 0;
    let queue = Promise.resolve();
    return {
        invalidate() {
            version++;
        },
        mount(root: HTMLElement, tabId: TSettingTab, keywords: string, result: SettingTabSearchResult) {
            const taskVersion = ++version;
            const previousQueue = queue;
            queue = previousQueue.catch(() => undefined).then(async () => {
                if (taskVersion !== version || !root.isConnected) {
                    if (!root.isConnected) {
                        unmountSettingTab(root, tabId);
                    }
                    return;
                }
                await getSettingTab(tabId).mount(root, {
                    keywords,
                    visibleItemIds: result.visibleItemIds,
                    visibleGroupIds: result.visibleGroupIds,
                    unavailableItems: result.unavailableItems,
                }, app);
                if (!root.isConnected) {
                    unmountSettingTab(root, tabId);
                }
            });
            void queue.catch((error) => console.error("mount setting search result failed", error));
        },
    };
};

/** 按关键字过滤主菜单项，返回命中的设置页及其扫描结果 */
const filterMainMenu = (element: HTMLElement, keywords: string) => {
    const matchedSettings = new Map<TSettingTab, SettingTabSearchResult>();
    let hasMatches = false;
    element.querySelectorAll<HTMLElement>(".mobile-main-menu__groups > .b3-menu__group").forEach((group) => {
        if (group.classList.contains("fn__none")) {
            group.classList.remove("config-search-hidden");
            return;
        }
        let groupHasMatches = false;
        group.querySelectorAll<HTMLElement>(":scope > .b3-menu__group-items > .b3-menu__item").forEach((item) => {
            const hidden = item.classList.contains("fn__none");
            if (hidden) {
                item.classList.remove("config-search-hidden");
                return;
            }
            const settingTabDef = getSettingTabFromMenuTarget(item);
            let settingTabMatches: boolean | undefined;
            if (settingTabDef) {
                const result = keywords ? getSettingTab(settingTabDef.id).scanSearch(keywords) : undefined;
                settingTabMatches = keywords ? Boolean(result?.matches) : undefined;
                if (result?.matches) {
                    matchedSettings.set(settingTabDef.id, result);
                }
            }
            const label = item.querySelector(":scope > .b3-menu__label")?.textContent ?? "";
            const matched = isMobileMenuSearchMatch(keywords, {
                hidden,
                label: normalizeSearchText(label),
                settingMatches: settingTabMatches,
            });
            item.classList.toggle("config-search-hidden", !matched);
            groupHasMatches ||= matched;
        });
        group.classList.toggle("config-search-hidden", !groupHasMatches);
        hasMatches ||= groupHasMatches;
    });
    element.querySelector('[data-type="menu-search-empty"]')?.classList.toggle("fn__none", !keywords || hasMatches);
    return matchedSettings;
};

export const createMainMenuSearch = (app: App, menuElement: HTMLElement): IMainMenuSearch => {
    const searchElement = menuElement.querySelector(".mobile-main-menu__search input") as HTMLInputElement;
    const groupsElement = menuElement.querySelector(".mobile-main-menu__groups") as HTMLElement;
    const searchMountQueue = createSettingSearchMountQueue(app);
    let selectedTabId: TSettingTab | undefined;

    const showSearchResult = (keywords: string, tabId: TSettingTab, result: SettingTabSearchResult) => {
        groupsElement.classList.toggle("mobile-main-menu__groups--bazaar", tabId === "bazaar");
        menuElement.querySelectorAll<HTMLElement>(".mobile-setting-menu__result").forEach((item) => {
            if (item.dataset.name !== tabId) {
                if (item.childElementCount > 0 || !item.classList.contains("fn__none")) {
                    clearSettingTabResult(item);
                }
            } else {
                item.classList.remove("fn__none");
            }
        });
        menuElement.querySelectorAll('[data-type="setting-tab"]').forEach((item) => {
            item.classList.toggle("b3-menu__item--current", (item as HTMLElement).dataset.name === tabId);
        });
        const root = menuElement.querySelector(`.mobile-setting-menu__result[data-name="${tabId}"]`) as HTMLElement;
        bindSettingSaveDelegation(root);
        searchMountQueue.mount(root, tabId, keywords, result);
    };

    const sync = () => {
        const keywords = normalizeSearchText(searchElement.value);
        const matches = filterMainMenu(menuElement, keywords);
        if (!keywords || matches.size === 0) {
            selectedTabId = undefined;
            searchMountQueue.invalidate();
            groupsElement.classList.remove("mobile-main-menu__groups--bazaar");
            clearSettingTabResults(menuElement);
            return;
        }
        if (!selectedTabId || !matches.has(selectedTabId)) {
            selectedTabId = matches.keys().next().value;
        }
        if (selectedTabId) {
            const result = matches.get(selectedTabId);
            if (result) {
                showSearchResult(keywords, selectedTabId, result);
            }
        }
    };

    const reset = (preserveKeyboard = false) => {
        // 转入输入型弹窗时保留键盘，避免 Android 异步隐藏键盘回调清除新输入框的焦点。
        if (!preserveKeyboard) {
            activeBlur();
        }
        selectedTabId = undefined;
        searchMountQueue.invalidate();
        searchElement.value = "";
        groupsElement.classList.remove("mobile-main-menu__groups--bazaar");
        clearSettingTabResults(menuElement);
        filterMainMenu(menuElement, "");
        groupsElement.scrollTop = 0;
    };

    searchElement.addEventListener("compositionend", sync);
    searchElement.addEventListener("input", (event: InputEvent) => {
        if (!event.isComposing) {
            sync();
        }
    });
    const pluginGroupItems = menuElement.querySelector("#menuPluginTopBar")?.parentElement;
    if (pluginGroupItems) {
        // 插件顶栏图标插入或显隐后需要重新过滤，否则搜索结果与可见项不一致
        new MutationObserver((mutations) => {
            const searchableContentChanged = mutations.some((mutation) => {
                if (mutation.type !== "attributes") {
                    return true;
                }
                const wasHidden = mutation.oldValue?.split(/\s+/).includes("fn__none") ?? false;
                return wasHidden !== (mutation.target as Element).classList.contains("fn__none");
            });
            if (searchableContentChanged && normalizeSearchText(searchElement.value)) {
                sync();
            }
        }).observe(pluginGroupItems, {
            attributes: true,
            attributeFilter: ["class"],
            attributeOldValue: true,
            childList: true,
            subtree: true,
            characterData: true,
        });
    }

    return {
        keywords: () => normalizeSearchText(searchElement.value),
        sync,
        reset,
        selectSettingTab(tabId: TSettingTab) {
            const keywords = normalizeSearchText(searchElement.value);
            const result = getSettingTab(tabId).scanSearch(keywords);
            if (!result.matches) {
                return false;
            }
            selectedTabId = tabId;
            showSearchResult(keywords, tabId, result);
            return true;
        },
    };
};
