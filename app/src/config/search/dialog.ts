import {getSettingTab, type TSettingTab} from "../setting/tabs";
import type {SettingTabMountContext} from "../setting/builder";
import {clearSettingTabSearch} from "../setting/mount";
import {getSearchKeywordsLower} from "./normalize";
import {App} from "../../index";
import {isPhablet} from "../../protyle/util/compatibility";

/** @param visibleInSidebar 为 true 时，侧栏项被搜索过滤隐藏（`display: none`）则视为无 focus */
const getFocusedTabId = (dialogElement: HTMLElement, visibleInSidebar = false): TSettingTab | null => {
    const focusLi = dialogElement.querySelector(".config__side .b3-list-item.b3-list-item--focus") as HTMLElement | null;
    if (!focusLi || (visibleInSidebar && focusLi.style.display === "none")) {
        return null;
    }
    return focusLi.getAttribute("data-name") as TSettingTab | null;
};

export const switchSettingTab = (
    dialogElement: HTMLElement,
    app: App,
    tabId: TSettingTab,
    search?: SettingTabMountContext,
) => {
    const containerElement = dialogElement.querySelector(`.config__tab-container[data-name="${tabId}"]`) as HTMLElement | null;
    if (!containerElement) {
        return;
    }

    const focusedTabId = getFocusedTabId(dialogElement);
    if (tabId === focusedTabId) {
        containerElement.classList.remove("fn__none");
    } else {
        dialogElement.querySelectorAll(".config__tab-container").forEach((container) => {
            container.classList.toggle("fn__none", container !== containerElement);
        });
        dialogElement.querySelectorAll(".config__side .b3-list-item").forEach((item) => {
            item.classList.toggle("b3-list-item--focus", item.getAttribute("data-name") === tabId);
        });
    }

    if (!search) {
        const keywords = getSearchKeywordsLower(dialogElement);
        if (keywords) {
            const {visibleItemIds, visibleGroupIds} = getSettingTab(tabId).scanSearch(keywords);
            search = {keywords, visibleItemIds, visibleGroupIds};
        }
    }
    void getSettingTab(tabId).mount(containerElement, search, app);
};

const syncSettingSearch = (dialogElement: HTMLElement, app: App) => {
    const keywords = getSearchKeywordsLower(dialogElement);
    if (!keywords) {
        dialogElement.querySelectorAll(".config__side .b3-list-item").forEach((item: HTMLElement) => {
            item.style.display = "";
        });
        clearSettingTabSearch(dialogElement);
        const focusedTabId = getFocusedTabId(dialogElement);
        if (focusedTabId) {
            switchSettingTab(dialogElement, app, focusedTabId);
        }
        return;
    }

    const focusedTabId = getFocusedTabId(dialogElement, true);
    let currentMatch: ({tabId: TSettingTab} & Pick<SettingTabMountContext, "visibleItemIds" | "visibleGroupIds">) | undefined;
    for (const item of dialogElement.querySelectorAll<HTMLElement>(".config__side .b3-list-item")) {
        const tabId = item.getAttribute("data-name") as TSettingTab | null;
        if (!tabId) {
            item.style.display = "none";
            continue;
        }
        const {matches, visibleItemIds, visibleGroupIds} = getSettingTab(tabId).scanSearch(keywords);
        if (!matches) {
            item.style.display = "none";
            continue;
        }
        item.style.display = "";
        // 优先使用当前标签页；若当前标签页已不在命中集合，则切到侧栏顺序中的第一个命中项
        if (tabId === focusedTabId || !currentMatch) {
            currentMatch = {tabId, visibleItemIds, visibleGroupIds};
        }
    }

    if (currentMatch) {
        switchSettingTab(dialogElement, app, currentMatch.tabId, {
            keywords,
            visibleItemIds: currentMatch.visibleItemIds,
            visibleGroupIds: currentMatch.visibleGroupIds,
        });
    } else {
        dialogElement.querySelectorAll(".config__tab-container").forEach((item) => {
            item.classList.add("fn__none");
        });
    }
};

export const initSettingSearch = (element: HTMLElement, app: App) => {
    const inputElement = element.querySelector(".config__tab-head .b3-text-field") as HTMLInputElement;
    if (!isPhablet()) {
        inputElement.focus();
    } else {
        (document.activeElement as HTMLElement)?.blur();
    }

    inputElement.addEventListener("compositionend", () => {
        syncSettingSearch(element, app);
    });
    inputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        syncSettingSearch(element, app);
    });
};
