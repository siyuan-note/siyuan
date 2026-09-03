import type {App} from "../../index";
import {Constants} from "../../constants";
import {isDisabledFeature, setStorageVal} from "../../protyle/util/compatibility";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {newFile} from "../../util/newFile";
import {openCard} from "../../card/openCard";
import {commandPanel} from "../../boot/globalEvent/command/panel";
import {popSearch} from "../menu/search";
import {getRecentDocs} from "../menu/getRecentDocs";
import {openDock} from "../dock/util";
import {closePanel} from "./closePanel";
import {activeBlur} from "./keyboardToolbar";
import {isMobileBlockSelecting} from "./mobileBars";
import {newDailyNote, newDailyNoteFromLastNotebook} from "../../util/mount";
import {
    getMobilePluginDockEntries,
    MOBILE_PLUGIN_DOCKS_CHANGE_EVENT,
    type IMobilePluginDockEntry,
} from "../dock/pluginDockState";
import {
    isMobileBottomBarAction,
    isMobileBottomBarBuiltInAction,
    MOBILE_BOTTOM_BAR_ACTIONS,
    normalizeMobileBottomBarConfig,
    reduceMobileBottomBarConfig,
    resolveMobileBottomBarAvailability,
    type IMobileBottomBarConfig,
    type MobileBottomBarAction,
    type MobileBottomBarBuiltInAction,
    type MobileBottomBarSlot,
} from "./mobileBottomBarConfig";

let bottomBarSettingPluginDocksChangeHandler: (() => void) | undefined;

const getActionLabel = (action: MobileBottomBarBuiltInAction) => {
    switch (action) {
        case "back":
            return window.siyuan.languages.goBack;
        case "forward":
            return window.siyuan.languages.goForward;
        case "documents":
            return window.siyuan.languages.fileTree;
        case "search":
            return window.siyuan.languages.search;
        case "newDoc":
            return window.siyuan.languages.newFile;
        case "tabs":
            return window.siyuan.languages.mobileTabs;
        case "recent":
            return window.siyuan.languages.recentDocs;
        case "outline":
            return window.siyuan.languages.outline;
        case "bookmark":
            return window.siyuan.languages.bookmark;
        case "tag":
            return window.siyuan.languages.tag;
        case "backlink":
            return window.siyuan.languages.backlinks;
        case "inbox":
            return window.siyuan.languages.inbox;
        case "agent":
            return window.siyuan.languages.agentChat;
        case "spacedRepetition":
            return window.siyuan.languages.spaceRepetition;
        case "dailyNote":
            return window.siyuan.languages.dailyNote;
        case "newDailyNote":
            return window.siyuan.languages.fileTree11;
        case "command":
            return window.siyuan.languages.commandPanel;
    }
};

const getPluginDockLabel = (entry: IMobilePluginDockEntry) =>
    `${entry.pluginDisplayName} - ${entry.config.title}`;

const getStoredBottomBarConfig = () =>
    normalizeMobileBottomBarConfig(window.siyuan.storage[Constants.LOCAL_MOBILE_BOTTOM_BAR]);

const resolveBottomBarConfig = (
    config: IMobileBottomBarConfig,
    pluginDockEntries: readonly IMobilePluginDockEntry[],
) => {
    const unavailableActions = new Set<MobileBottomBarAction>();
    if (window.siyuan.config.readonly) {
        unavailableActions.add("newDoc");
        unavailableActions.add("dailyNote");
        unavailableActions.add("newDailyNote");
        unavailableActions.add("agent");
        unavailableActions.add("spacedRepetition");
    } else if (window.siyuan.isPublish) {
        unavailableActions.add("newDoc");
        unavailableActions.add("dailyNote");
        unavailableActions.add("newDailyNote");
        unavailableActions.add("agent");
    }
    if (isDisabledFeature("ai")) {
        unavailableActions.add("agent");
    }
    const pluginDockKeys = new Set(pluginDockEntries.map(entry => entry.key));
    config.actions.forEach((action) => {
        if (!isMobileBottomBarBuiltInAction(action) && !pluginDockKeys.has(action)) {
            unavailableActions.add(action);
        }
    });
    if (unavailableActions.size === 0) {
        return config;
    }
    return resolveMobileBottomBarAvailability(config, [...unavailableActions]);
};

const setBottomBarConfig = (config: IMobileBottomBarConfig) => {
    window.siyuan.storage[Constants.LOCAL_MOBILE_BOTTOM_BAR] = config;
    setStorageVal(Constants.LOCAL_MOBILE_BOTTOM_BAR, config);
    renderMobileBottomBar();
};

const updateActionLabel = (element: HTMLElement, label: string) => {
    element.setAttribute("aria-label", label);
    element.setAttribute("title", label);
};

export const renderMobileBottomBar = () => {
    const bottomBarElement = document.getElementById("mobileBottomBar");
    const moreElement = document.getElementById("toolbarMore");
    if (!bottomBarElement || !moreElement) {
        return;
    }

    const pluginDockEntries = getMobilePluginDockEntries();
    const pluginDockEntriesByKey = new Map(pluginDockEntries.map(entry => [entry.key, entry]));
    const config = resolveBottomBarConfig(getStoredBottomBarConfig(), pluginDockEntries);
    bottomBarElement.querySelectorAll("[data-mobile-plugin-dock]").forEach(item => item.remove());
    MOBILE_BOTTOM_BAR_ACTIONS.forEach((action) => {
        const element = bottomBarElement.querySelector<HTMLElement>(`[data-action="${action}"]`);
        if (!element) {
            return;
        }
        element.classList.add("fn__none");
        element.removeAttribute("data-slot");
        updateActionLabel(element, getActionLabel(action));
    });
    config.actions.forEach((action, slot) => {
        let element: HTMLElement | null;
        if (isMobileBottomBarBuiltInAction(action)) {
            element = bottomBarElement.querySelector<HTMLElement>(`[data-action="${action}"]`);
            element?.classList.remove("fn__none");
        } else {
            const pluginDockEntry = pluginDockEntriesByKey.get(action);
            if (!pluginDockEntry) {
                return;
            }
            element = document.createElement("button");
            element.className = "mobile-bottom-bar__item";
            element.setAttribute("type", "button");
            element.dataset.action = action;
            element.dataset.mobilePluginDock = pluginDockEntry.type;
            element.innerHTML = `<svg><use xlink:href="#${escapeAttr(pluginDockEntry.config.icon)}"></use></svg>`;
            updateActionLabel(element, getPluginDockLabel(pluginDockEntry));
        }
        if (!element) {
            return;
        }
        element.dataset.slot = slot.toString();
        bottomBarElement.insertBefore(element, moreElement);
    });
    updateActionLabel(moreElement, window.siyuan.languages.more);
    bottomBarElement.setAttribute("aria-label", window.siyuan.languages.mobileBottomBar);
    ["mobileBottomBarNewDoc", "mobileBottomBarDailyNote", "mobileBottomBarNewDailyNote"].forEach((id) => {
        (document.getElementById(id) as HTMLButtonElement).disabled =
            window.siyuan.config.readonly || window.siyuan.isPublish;
    });
};

const bindBottomBarAction = (id: string, callback: () => void) => {
    const element = document.getElementById(id);
    if (!element) {
        return;
    }
    element.addEventListener("click", callback);
};

export const initMobileBottomBar = (app: App) => {
    renderMobileBottomBar();
    const bottomBarElement = document.getElementById("mobileBottomBar");
    if (!bottomBarElement || bottomBarElement.dataset.bound === "true") {
        return;
    }
    bottomBarElement.classList.remove("fn__none");
    bottomBarElement.dataset.bound = "true";
    window.addEventListener(MOBILE_PLUGIN_DOCKS_CHANGE_EVENT, renderMobileBottomBar);
    bottomBarElement.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const pluginDockElement = target.closest<HTMLElement>("[data-mobile-plugin-dock]");
        if (!pluginDockElement || !bottomBarElement.contains(pluginDockElement) || isMobileBlockSelecting()) {
            return;
        }
        const type = pluginDockElement.dataset.mobilePluginDock;
        if (type) {
            openDock(type);
        }
    });
    bindBottomBarAction("mobileBottomBarBack", () => {
        if (isMobileBlockSelecting()) {
            return;
        }
        activeBlur();
        void window.siyuan.mobile.tabs?.goBack();
    });
    bindBottomBarAction("mobileBottomBarForward", () => {
        if (isMobileBlockSelecting()) {
            return;
        }
        activeBlur();
        void window.siyuan.mobile.tabs?.goForward();
    });
    bindBottomBarAction("mobileBottomBarSearch", () => {
        if (isMobileBlockSelecting()) {
            return;
        }
        activeBlur();
        popSearch(app);
    });
    bindBottomBarAction("mobileBottomBarNewDoc", () => {
        if (isMobileBlockSelecting()) {
            return;
        }
        activeBlur();
        newFile(app);
        closePanel();
    });
    bindBottomBarAction("mobileBottomBarRecent", () => {
        if (isMobileBlockSelecting()) {
            return;
        }
        activeBlur();
        getRecentDocs(app);
    });
    bindBottomBarAction("mobileBottomBarOutline", () => {
        if (!isMobileBlockSelecting()) {
            openDock("outline");
        }
    });
    bindBottomBarAction("mobileBottomBarBookmark", () => {
        if (!isMobileBlockSelecting()) {
            openDock("bookmark");
        }
    });
    bindBottomBarAction("mobileBottomBarTag", () => {
        if (!isMobileBlockSelecting()) {
            openDock("tag");
        }
    });
    bindBottomBarAction("mobileBottomBarBacklink", () => {
        if (!isMobileBlockSelecting()) {
            openDock("backlink");
        }
    });
    bindBottomBarAction("mobileBottomBarInbox", () => {
        if (!isMobileBlockSelecting()) {
            openDock("inbox");
        }
    });
    bindBottomBarAction("mobileBottomBarAgent", () => {
        if (isMobileBlockSelecting()) {
            return;
        }
        activeBlur();
        void import("../agent/MobileAgentChat").then(({openMobileAgent}) => openMobileAgent(app));
    });
    bindBottomBarAction("mobileBottomBarSpacedRepetition", () => {
        if (isMobileBlockSelecting()) {
            return;
        }
        activeBlur();
        openCard(app);
        closePanel();
    });
    bindBottomBarAction("mobileBottomBarDailyNote", () => {
        if (isMobileBlockSelecting()) {
            return;
        }
        activeBlur();
        newDailyNote(app);
        closePanel();
    });
    bindBottomBarAction("mobileBottomBarNewDailyNote", () => {
        if (isMobileBlockSelecting()) {
            return;
        }
        activeBlur();
        newDailyNoteFromLastNotebook(app);
        closePanel();
    });
    bindBottomBarAction("mobileBottomBarCommand", () => {
        if (isMobileBlockSelecting()) {
            return;
        }
        activeBlur();
        closePanel();
        commandPanel(app);
    });
};

const genBottomBarOptions = (pluginDockEntries: readonly IMobilePluginDockEntry[]) => [
    ...MOBILE_BOTTOM_BAR_ACTIONS.map((action) =>
        `<option value="${action}"${action === "agent" && isDisabledFeature("ai") ? " disabled" : ""}>${escapeHtml(getActionLabel(action))}</option>`),
    ...pluginDockEntries.map((entry) =>
        `<option value="${escapeAttr(entry.key)}">${escapeHtml(getPluginDockLabel(entry))}</option>`),
].join("");

export const genMobileBottomBarSettingHTML = () => {
    const title = window.siyuan.languages.mobileBottomBar;
    const disabled = window.siyuan.config.readonly || window.siyuan.isPublish ? " disabled" : "";
    const options = genBottomBarOptions(getMobilePluginDockEntries());
    const selects = [0, 1, 2, 3, 4].map((slot) => `<label class="mobile-bottom-bar-setting__slot">
        <span>${slot + 1}</span>
        <select class="b3-select fn__flex-1" data-bottom-bar-slot="${slot}" aria-label="${escapeAttr(`${title} ${slot + 1}`)}"${disabled}>${options}</select>
    </label>`).join("");
    return `<div id="mobileBottomBarSetting" class="b3-label config-item mobile-bottom-bar-setting">
    <div class="fn__flex">
        <div class="fn__flex-1 config-item__main"><div class="config-name">${escapeHtml(title)}</div></div>
        <button class="b3-button b3-button--outline" data-type="reset" type="button"${disabled}>
            <svg><use xlink:href="#iconUndo"></use></svg>${escapeHtml(window.siyuan.languages.reset)}
        </button>
    </div>
    <div class="mobile-bottom-bar-setting__slots">${selects}</div>
</div>`;
};

export const mountMobileBottomBarSetting = (root: HTMLElement) => {
    const settingElement = root.querySelector<HTMLElement>("#mobileBottomBarSetting");
    if (!settingElement) {
        return;
    }
    let config = getStoredBottomBarConfig();
    let pluginDockEntries = getMobilePluginDockEntries();
    const syncSelects = (refreshOptions = false) => {
        const resolvedConfig = resolveBottomBarConfig(config, pluginDockEntries);
        const options = refreshOptions ? genBottomBarOptions(pluginDockEntries) : "";
        settingElement.querySelectorAll<HTMLSelectElement>("[data-bottom-bar-slot]").forEach((selectElement) => {
            const slot = Number(selectElement.dataset.bottomBarSlot) as MobileBottomBarSlot;
            if (refreshOptions) {
                selectElement.innerHTML = options;
            }
            selectElement.value = resolvedConfig.actions[slot];
        });
    };
    settingElement.addEventListener("change", (event) => {
        const selectElement = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-bottom-bar-slot]");
        if (!selectElement) {
            return;
        }
        const slot = Number(selectElement.dataset.bottomBarSlot);
        const action = selectElement.value;
        const pluginDockKeys = new Set(pluginDockEntries.map(entry => entry.key));
        if (![0, 1, 2, 3, 4].includes(slot) || !isMobileBottomBarAction(action) ||
            (!isMobileBottomBarBuiltInAction(action) && !pluginDockKeys.has(action))) {
            syncSelects();
            return;
        }
        config = reduceMobileBottomBarConfig(config, {
            type: "select-action",
            slot: slot as MobileBottomBarSlot,
            action,
        });
        setBottomBarConfig(config);
        syncSelects();
    });
    settingElement.querySelector('[data-type="reset"]')?.addEventListener("click", () => {
        config = reduceMobileBottomBarConfig(config, {type: "reset"});
        setBottomBarConfig(config);
        syncSelects();
    });
    const onPluginDocksChange = () => {
        if (!settingElement.isConnected) {
            window.removeEventListener(MOBILE_PLUGIN_DOCKS_CHANGE_EVENT, onPluginDocksChange);
            if (bottomBarSettingPluginDocksChangeHandler === onPluginDocksChange) {
                bottomBarSettingPluginDocksChangeHandler = undefined;
            }
            return;
        }
        pluginDockEntries = getMobilePluginDockEntries();
        syncSelects(true);
    };
    if (bottomBarSettingPluginDocksChangeHandler) {
        window.removeEventListener(MOBILE_PLUGIN_DOCKS_CHANGE_EVENT, bottomBarSettingPluginDocksChangeHandler);
    }
    bottomBarSettingPluginDocksChangeHandler = onPluginDocksChange;
    window.addEventListener(MOBILE_PLUGIN_DOCKS_CHANGE_EVENT, onPluginDocksChange);
    syncSelects();
};
