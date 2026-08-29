import {popSearch} from "./search";
import {closeModel, closePanel, MOBILE_MENU_CLOSE_EVENT} from "../util/closePanel";
import {mountHelp, newDailyNote, newEncryptedNotebook, newNotebook} from "../../util/mount";
import {exitSiYuan, lockScreen, processSync} from "../../dialog/processSystem";
import {openHistory} from "../../history/history";
import {syncGuide} from "../../sync/syncGuide";
import {openCard} from "../../card/openCard";
import {activeBlur} from "../util/keyboardToolbar";
import {getRecentDocs} from "./getRecentDocs";
import type {App} from "../../index";
import {isDisabledFeature, isInMobileApp} from "../../protyle/util/compatibility";
import {newFile} from "../../util/newFile";
import {afterLayoutReady} from "../../plugin/loader";
import {commandPanel} from "../../boot/globalEvent/command/panel";
import {openTopBarMenu} from "../../plugin/openTopBarMenu";
import {settingTabToMenuId, getSettingTab, getSettingTabDefs, type ISettingTabShell, type TSettingTab} from "../../config/setting/tabs";
import {bindSettingSaveDelegation} from "../../config/setting/save";
import {isMobile} from "../../util/functions";
import {openModel} from "./model";
import {getCurrentEditor} from "../editor";
import {openDataMigration} from "../../menus/dataMigration";
import {normalizeSearchText} from "../../config/search/normalize";
import type {SettingTabSearchResult} from "../../config/setting/builder";
import {unmountBazaarTab} from "../../config/bazaarTab";
import {openDock} from "../dock/util";
import {clearSyncTabElement} from "../../config/tabs/syncRuntime";
import {clearAccessTabElement} from "../../config/tabs/accessRuntime";
import {isMobileMenuSearchMatch} from "./searchFilter";
import {unmountAssetsTab} from "../../config/assets";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {getMobilePluginDockEntries, MOBILE_PLUGIN_DOCKS_CHANGE_EVENT} from "../dock/pluginDockState";

const getSettingTabFromMenuTarget = (target: HTMLElement): ISettingTabShell<TSettingTab> | undefined => {
    const item = target.closest(".b3-menu__item") as HTMLElement | null;
    const tabId = item?.dataset.name;
    if (item?.dataset.type !== "setting-tab" || !tabId) {
        return undefined;
    }
    return getSettingTabDefs().find(def => def.id === tabId);
};

const getSettingTabsMenuHTML = (includeIds = false) => getSettingTabDefs().map(def =>
    `<div class="b3-menu__item${def.hidden ? " fn__none" : ""}"${includeIds ? ` id="${settingTabToMenuId(def.id)}"` : ""} data-type="setting-tab" data-name="${def.id}">
        <svg class="b3-menu__icon"><use xlink:href="#${def.icon}"></use></svg>
        <span class="b3-menu__label">${def.title}</span>
    </div>`).join("");

const getSettingTabResultsHTML = () => getSettingTabDefs().map(def =>
    `<div class="config mobile-setting-menu__result fn__none" data-name="${def.id}"></div>`).join("");

const unmountSettingTab = (root: HTMLElement, tabId: TSettingTab) => {
    if (tabId === "bazaar") {
        unmountBazaarTab(root);
    } else if (tabId === "assets") {
        unmountAssetsTab(root);
    } else if (tabId === "sync") {
        clearSyncTabElement(root);
    } else if (tabId === "access") {
        clearAccessTabElement(root);
    }
};

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

const filterSettingTabsMenu = (element: HTMLElement, keywords: string) => {
    const matches = new Map<TSettingTab, SettingTabSearchResult>();
    for (const def of getSettingTabDefs()) {
        if (def.hidden) {
            continue;
        }
        const item = element.querySelector(`[data-type="setting-tab"][data-name="${def.id}"]`);
        const result = keywords ? getSettingTab(def.id).scanSearch(keywords) : undefined;
        const matched = !keywords || result?.matches;
        item?.classList.toggle("config-search-hidden", !matched);
        if (result?.matches) {
            matches.set(def.id, result);
        }
    }
    element.querySelector('[data-type="setting-search-empty"]')?.classList.toggle("fn__none", !keywords || matches.size > 0);
    return matches;
};

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

const openSettingTab = (app: App, settingTabDef: ISettingTabShell<TSettingTab>, returnCallback?: () => void) => {
    let root: HTMLElement | undefined;
    openModel({
        title: settingTabDef.title,
        icon: "iconLeft",
        html: `<div class="config${isMobile() ? " config--mobile" : ""}"></div>`,
        bindEvent(modelMainElement: HTMLElement) {
            root = modelMainElement.firstElementChild as HTMLElement;
            bindSettingSaveDelegation(root);
            const mountedRoot = root;
            void getSettingTab(settingTabDef.id).mount(mountedRoot, undefined, app).then(() => {
                if (mountedRoot.isConnected) {
                    mountedRoot.classList.toggle("config--mobile-items", Boolean(mountedRoot.querySelector(":scope > .config-group")));
                } else {
                    unmountSettingTab(mountedRoot, settingTabDef.id);
                }
            });
        },
        destroyCallback() {
            if (root) {
                unmountSettingTab(root, settingTabDef.id);
                root.remove();
            }
        },
        backCallback() {
            if (settingTabDef.id === "bazaar") {
                const readmeElement = root?.querySelector("#configBazaarReadme.config__view--show");
                if (readmeElement) {
                    readmeElement.classList.remove("config__view--show");
                    return false;
                }
            }
            if (returnCallback) {
                returnCallback();
            } else {
                openSettingMenu(app, "back");
            }
        },
        transition: "forward",
    });
};

const openSettingMenu = (
    app: App,
    transition?: "back",
    returnCallback?: () => void,
) => {
    let settingMenuElement: HTMLElement | undefined;
    const searchMountQueue = createSettingSearchMountQueue(app);
    openModel({
        title: window.siyuan.languages.config,
        icon: "iconLeft",
        html: `<div class="mobile-setting-menu">
    <div class="mobile-setting-menu__search">
        <input placeholder="${window.siyuan.languages.searchPlaceholder}" class="b3-text-field fn__flex-1" autocomplete="off" autocorrect="off" spellcheck="false">
    </div>
    <div class="b3-menu__groups mobile-setting-menu__groups">
        <div class="b3-menu__group">
            <div class="b3-menu__group-items">${getSettingTabsMenuHTML()}</div>
        </div>
        <div class="b3-list--empty fn__none" data-type="setting-search-empty">${window.siyuan.languages.emptyContent}</div>
        ${getSettingTabResultsHTML()}
    </div>
</div>`,
        bindEvent(modelMainElement: HTMLElement) {
            settingMenuElement = modelMainElement;
            const searchElement = modelMainElement.querySelector("input") as HTMLInputElement;
            const groupsElement = modelMainElement.querySelector(".mobile-setting-menu__groups") as HTMLElement;
            let selectedTabId: TSettingTab | undefined;
            const showSearchResult = (keywords: string, tabId: TSettingTab, result: SettingTabSearchResult) => {
                groupsElement.classList.toggle("mobile-setting-menu__groups--bazaar", tabId === "bazaar");
                modelMainElement.querySelectorAll<HTMLElement>(".mobile-setting-menu__result").forEach((item) => {
                    if (item.dataset.name !== tabId) {
                        if (item.childElementCount > 0 || !item.classList.contains("fn__none")) {
                            clearSettingTabResult(item);
                        }
                    } else {
                        item.classList.remove("fn__none");
                    }
                });
                modelMainElement.querySelectorAll('[data-type="setting-tab"]').forEach((item) => {
                    item.classList.toggle("b3-menu__item--current", (item as HTMLElement).dataset.name === tabId);
                });
                const root = modelMainElement.querySelector(`.mobile-setting-menu__result[data-name="${tabId}"]`) as HTMLElement;
                bindSettingSaveDelegation(root);
                searchMountQueue.mount(root, tabId, keywords, result);
            };
            const syncSearch = () => {
                const keywords = normalizeSearchText(searchElement.value);
                const matches = filterSettingTabsMenu(modelMainElement, keywords);
                if (!keywords || matches.size === 0) {
                    selectedTabId = undefined;
                    searchMountQueue.invalidate();
                    groupsElement.classList.remove("mobile-setting-menu__groups--bazaar");
                    clearSettingTabResults(modelMainElement);
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
            searchElement.addEventListener("compositionend", syncSearch);
            searchElement.addEventListener("input", (event: InputEvent) => {
                if (!event.isComposing) {
                    syncSearch();
                }
            });
            modelMainElement.addEventListener("click", (event) => {
                const def = getSettingTabFromMenuTarget(event.target as HTMLElement);
                if (def) {
                    const keywords = normalizeSearchText(searchElement.value);
                    if (keywords) {
                        const result = getSettingTab(def.id).scanSearch(keywords);
                        if (!result.matches) {
                            return;
                        }
                        selectedTabId = def.id;
                        showSearchResult(keywords, def.id, result);
                        return;
                    }
                    openSettingTab(app, def, () => openSettingMenu(app, "back", returnCallback));
                }
            });
            syncSearch();
        },
        destroyCallback() {
            searchMountQueue.invalidate();
            if (settingMenuElement) {
                clearSettingTabResults(settingMenuElement);
                settingMenuElement.replaceChildren();
            }
        },
        backCallback() {
            if (returnCallback) {
                returnCallback();
            } else {
                closeModel();
            }
        },
        transition,
    });
};

export const openMobileSetting = (app: App, tab?: TSettingTab, returnCallback?: () => void) => {
    activeBlur();
    document.getElementById("menu")?.dispatchEvent(new CustomEvent(MOBILE_MENU_CLOSE_EVENT));
    if (tab) {
        const settingTabDef = getSettingTabDefs().find(def => def.id === tab);
        if (!settingTabDef || settingTabDef.hidden) {
            return;
        }
        openSettingTab(app, settingTabDef, returnCallback);
        return;
    }
    openSettingMenu(app, undefined, returnCallback);
};

export const popMenu = () => {
    if (getCurrentEditor()?.protyle.toolbar.isMultiSelectMode()) {
        return;
    }
    activeBlur();
    closePanel();
    const menuElement = document.getElementById("menu");
    menuElement.style.zIndex = (++window.siyuan.zIndex).toString();
    menuElement.style.transform = "translateX(0px)";
};

const renderMobilePluginDockMenu = (app: App, menuElement: HTMLElement) => {
    menuElement.querySelectorAll('[data-type="mobile-plugin-dock"]').forEach(item => item.remove());
    const markerElement = menuElement.querySelector("#menuPluginDocks");
    if (!markerElement) {
        return;
    }
    const html = getMobilePluginDockEntries(app).map((entry) =>
        `<div class="b3-menu__item" data-type="mobile-plugin-dock" data-plugin-dock-key="${escapeAttr(entry.key)}">
            <svg class="b3-menu__icon"><use xlink:href="#${escapeAttr(entry.config.icon)}"></use></svg>
            <span class="b3-menu__label">${escapeHtml(`${entry.pluginDisplayName} - ${entry.config.title}`)}</span>
        </div>`).join("");
    markerElement.insertAdjacentHTML("beforebegin", html);
};

export const initRightMenu = (app: App) => {
    const menuElement = document.getElementById("menu");
    menuElement.innerHTML = `<div class="b3-menu__title">
    <svg class="b3-menu__icon"><use xlink:href="#iconLeft"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.back}</span>
</div>
<div class="mobile-main-menu__search" data-prevent-swipe>
    <input placeholder="${window.siyuan.languages.searchPlaceholder}" class="b3-text-field fn__block" autocomplete="off" autocorrect="off" spellcheck="false">
</div>
<div class="b3-menu__items b3-menu__groups mobile-main-menu__groups">
    <div class="b3-menu__group">
        <div class="b3-menu__group-title">${window.siyuan.languages.mobileMenuNavigation}</div>
        <div class="b3-menu__group-items">
            <div id="menuDocuments" class="b3-menu__item">
                <svg class="b3-menu__icon"><use xlink:href="#iconFiles"></use></svg><span class="b3-menu__label">${window.siyuan.languages.fileTree}</span>
            </div>
            <div id="menuTabs" class="b3-menu__item">
                <svg class="b3-menu__icon"><use xlink:href="#iconLayoutGrid"></use></svg><span class="b3-menu__label">${window.siyuan.languages.mobileTabs}</span>
            </div>
            <div id="menuOutline" class="b3-menu__item">
                <svg class="b3-menu__icon"><use xlink:href="#iconOutline"></use></svg><span class="b3-menu__label">${window.siyuan.languages.outline}</span>
            </div>
            <div id="menuBookmark" class="b3-menu__item">
                <svg class="b3-menu__icon"><use xlink:href="#iconBookmark"></use></svg><span class="b3-menu__label">${window.siyuan.languages.bookmark}</span>
            </div>
            <div id="menuTag" class="b3-menu__item">
                <svg class="b3-menu__icon"><use xlink:href="#iconTag"></use></svg><span class="b3-menu__label">${window.siyuan.languages.tag}</span>
            </div>
            <div id="menuBacklink" class="b3-menu__item">
                <svg class="b3-menu__icon"><use xlink:href="#iconLink"></use></svg><span class="b3-menu__label">${window.siyuan.languages.backlinks}</span>
            </div>
            <div id="menuInbox" class="b3-menu__item">
                <svg class="b3-menu__icon"><use xlink:href="#iconInbox"></use></svg><span class="b3-menu__label">${window.siyuan.languages.inbox}</span>
            </div>
            <div id="menuRecent" class="b3-menu__item">
                <svg class="b3-menu__icon"><use xlink:href="#iconList"></use></svg><span class="b3-menu__label">${window.siyuan.languages.recentDocs}</span>
            </div>
            <div id="menuSearch" class="b3-menu__item">
                <svg class="b3-menu__icon"><use xlink:href="#iconSearch"></use></svg><span class="b3-menu__label">${window.siyuan.languages.search}</span>
            </div>
            <div id="menuAgentChat" class="b3-menu__item${window.siyuan.config.readonly || window.siyuan.isPublish || isDisabledFeature("ai") ? " fn__none" : ""}">
                <svg class="b3-menu__icon"><use xlink:href="#iconSparkles"></use></svg>
                <span class="b3-menu__label">${window.siyuan.languages.agentChat}</span>
                <span data-type="agent-status" class="b3-menu__accelerator fn__none"></span>
            </div>
            <div id="menuCommand" class="b3-menu__item">
                <svg class="b3-menu__icon"><use xlink:href="#iconTerminal"></use></svg><span class="b3-menu__label">${window.siyuan.languages.commandPanel}</span>
            </div>
            <div id="menuCard" class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}">
                <svg class="b3-menu__icon"><use xlink:href="#iconRiffCard"></use></svg><span class="b3-menu__label">${window.siyuan.languages.spaceRepetition}</span>
            </div>
            <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuLock">
                <svg class="b3-menu__icon"><use xlink:href="#iconLock"></use></svg><span class="b3-menu__label">${window.siyuan.languages.lockScreen}</span>
            </div>
            <div class="b3-menu__item b3-menu__item--warning${isInMobileApp() ? "" : " fn__none"}" id="menuSafeQuit">
                <svg class="b3-menu__icon"><use xlink:href="#iconQuit"></use></svg><span class="b3-menu__label">${window.siyuan.languages.safeQuit}</span>
            </div>
        </div>
    </div>
    <div class="b3-menu__group${window.siyuan.config.readonly ? " fn__none" : ""}">
        <div class="b3-menu__group-title">${window.siyuan.languages.mobileMenuCreate}</div>
        <div class="b3-menu__group-items">
            <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuNewDoc">
                <svg class="b3-menu__icon"><use xlink:href="#iconFile"></use></svg><span class="b3-menu__label">${window.siyuan.languages.newFile}</span>
            </div>
            <div id="menuNewDaily" class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}">
                <svg class="b3-menu__icon"><use xlink:href="#iconCalendar"></use></svg><span class="b3-menu__label">${window.siyuan.languages.dailyNote}</span>
            </div>
            <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuNewNotebook">
                <svg class="b3-menu__icon"><use xlink:href="#iconNewNoteBook"></use></svg><span class="b3-menu__label">${window.siyuan.languages.newNotebook}</span>
            </div>
            <div class="b3-menu__item${(window.siyuan.config.readonly || !window.siyuan.config.notebookCrypto?.enabled) ? " fn__none" : ""}" id="menuNewEncryptedNotebook">
                <svg class="b3-menu__icon"><use xlink:href="#iconLock"></use></svg><span class="b3-menu__label">${window.siyuan.languages.newEncryptedNotebook}</span>
            </div>
        </div>
    </div>
    <div class="b3-menu__group${window.siyuan.config.readonly ? " fn__none" : ""}">
        <div class="b3-menu__group-title">${window.siyuan.languages.mobileMenuDataManagement}</div>
        <div class="b3-menu__group-items">
            <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuSyncNow">
                <svg class="b3-menu__icon"><use xlink:href="#iconCloudSucc"></use></svg><span class="b3-menu__label">${window.siyuan.languages.syncNow}</span>
            </div>
            <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuHistory">
                <svg class="b3-menu__icon"><use xlink:href="#iconHistory"></use></svg><span class="b3-menu__label">${window.siyuan.languages.dataHistory}</span>
            </div>
            <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuImport">
                <svg class="b3-menu__icon"><use xlink:href="#iconDatabaseBackup"></use></svg><span class="b3-menu__label">${window.siyuan.languages.dataMigration}</span>
            </div>
        </div>
    </div>
    <div class="b3-menu__group">
        <div class="b3-menu__group-title">${window.siyuan.languages.extensions}</div>
        <div class="b3-menu__group-items">
            <div class="b3-menu__item" id="menuPlugin">
                <svg class="b3-menu__icon"><use xlink:href="#iconPlugin"></use></svg><span class="b3-menu__label">${window.siyuan.languages.plugin}</span>
            </div>
            <div id="menuPluginTopBar" class="fn__none"></div>
            <div id="menuPluginDocks" class="fn__none"></div>
        </div>
    </div>
    <div class="b3-menu__group">
        <div class="b3-menu__group-title">${window.siyuan.languages.mobileMenuSettingsAndHelp}</div>
        <div class="b3-menu__group-items">
            ${getSettingTabsMenuHTML(true)}
            <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuHelp">
                <svg class="b3-menu__icon"><use xlink:href="#iconHelp"></use></svg><span class="b3-menu__label">${window.siyuan.languages.userGuide}</span>
            </div>
            <a class="b3-menu__item" href="${"zh-CN" === window.siyuan.config.lang ? "https://ld246.com/article/1649901726096" : "https://liuyun.io/article/1686530886208"}" target="_blank">
                <svg class="b3-menu__icon"><use xlink:href="#iconFeedback"></use></svg>
                <span class="b3-menu__label">${window.siyuan.languages.feedback}</span>
            </a>
        </div>
    </div>
    <div class="b3-list--empty fn__none" data-type="menu-search-empty">${window.siyuan.languages.emptyContent}</div>
    ${getSettingTabResultsHTML()}
</div>`;
    renderMobilePluginDockMenu(app, menuElement);
    window.addEventListener(MOBILE_PLUGIN_DOCKS_CHANGE_EVENT, () => {
        renderMobilePluginDockMenu(app, menuElement);
    });
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
    const syncSearch = () => {
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
    const resetSearch = () => {
        activeBlur();
        selectedTabId = undefined;
        searchMountQueue.invalidate();
        searchElement.value = "";
        groupsElement.classList.remove("mobile-main-menu__groups--bazaar");
        clearSettingTabResults(menuElement);
        filterMainMenu(menuElement, "");
        groupsElement.scrollTop = 0;
    };
    searchElement.addEventListener("compositionend", syncSearch);
    searchElement.addEventListener("input", (event: InputEvent) => {
        if (!event.isComposing) {
            syncSearch();
        }
    });
    menuElement.addEventListener(MOBILE_MENU_CLOSE_EVENT, resetSearch);
    const pluginGroupItems = menuElement.querySelector("#menuPluginTopBar")?.parentElement;
    if (pluginGroupItems) {
        new MutationObserver((mutations) => {
            const searchableContentChanged = mutations.some((mutation) => {
                if (mutation.type !== "attributes") {
                    return true;
                }
                const wasHidden = mutation.oldValue?.split(/\s+/).includes("fn__none") ?? false;
                return wasHidden !== (mutation.target as Element).classList.contains("fn__none");
            });
            if (searchableContentChanged && normalizeSearchText(searchElement.value)) {
                syncSearch();
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
    window.siyuan.mobile.agentChatController?.refreshStatus();
    processSync();
    afterLayoutReady(app);
    // 只能用 click，否则无法上下滚动 https://github.com/siyuan-note/siyuan/issues/6628
    menuElement.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(menuElement)) {
            const settingTabDef = getSettingTabFromMenuTarget(target);
            if (target.classList.contains("b3-menu__title")) {
                closePanel();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (settingTabDef) {
                const keywords = normalizeSearchText(searchElement.value);
                if (keywords) {
                    const result = getSettingTab(settingTabDef.id).scanSearch(keywords);
                    if (!result.matches) {
                        return;
                    }
                    selectedTabId = settingTabDef.id;
                    showSearchResult(keywords, settingTabDef.id, result);
                } else {
                    openSettingTab(app, settingTabDef, closeModel);
                }
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuDocuments") {
                closePanel();
                openDock("file");
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuTabs") {
                closePanel();
                document.getElementById("toolbarTabs").dispatchEvent(new CustomEvent("click"));
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (["menuOutline", "menuBookmark", "menuTag", "menuBacklink", "menuInbox"].includes(target.id)) {
                closePanel();
                openDock(target.id.replace("menu", "").toLowerCase());
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuRecent") {
                getRecentDocs(app);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuSearch") {
                popSearch(app);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuAgentChat") {
                void import("../agent/MobileAgentChat").then(({openMobileAgent}) => openMobileAgent(app));
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuCommand") {
                closePanel();
                commandPanel(app);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuSyncNow") {
                syncGuide(app);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuNewDoc") {
                newFile(app);
                closePanel();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuNewNotebook") {
                newNotebook();
                closePanel();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuNewEncryptedNotebook") {
                newEncryptedNotebook();
                closePanel();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuImport") {
                closePanel();
                openDataMigration();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuNewDaily") {
                newDailyNote(app);
                closePanel();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuCard") {
                openCard(app);
                closePanel();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuLock") {
                lockScreen();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuHistory") {
                openHistory(app);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuSafeQuit") {
                event.preventDefault();
                event.stopPropagation();
                exitSiYuan();
                break;
            } else if (target.dataset.type === "mobile-plugin-dock") {
                const pluginDockEntry = getMobilePluginDockEntries(app)
                    .find(entry => entry.key === target.dataset.pluginDockKey);
                closePanel();
                if (pluginDockEntry) {
                    openDock(pluginDockEntry.type);
                }
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuPlugin") {
                openTopBarMenu(app);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuHelp") {
                mountHelp();
                event.preventDefault();
                event.stopPropagation();
                break;
            }
            target = target.parentElement;
        }
    });
};
