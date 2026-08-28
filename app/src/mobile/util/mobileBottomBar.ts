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
    MOBILE_BOTTOM_BAR_ACTIONS,
    normalizeMobileBottomBarConfig,
    reduceMobileBottomBarConfig,
    resolveMobileBottomBarAvailability,
    type IMobileBottomBarConfig,
    type MobileBottomBarAction,
    type MobileBottomBarSlot,
} from "./mobileBottomBarConfig";

const getActionLabel = (action: MobileBottomBarAction) => {
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

const getBottomBarConfig = () => {
    const config = normalizeMobileBottomBarConfig(window.siyuan.storage[Constants.LOCAL_MOBILE_BOTTOM_BAR]);
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

    const config = getBottomBarConfig();
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
        const element = bottomBarElement.querySelector<HTMLElement>(`[data-action="${action}"]`);
        if (!element) {
            return;
        }
        element.classList.remove("fn__none");
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

const genBottomBarOptions = () => MOBILE_BOTTOM_BAR_ACTIONS.map((action) =>
    `<option value="${action}"${action === "agent" && isDisabledFeature("ai") ? " disabled" : ""}>${escapeHtml(getActionLabel(action))}</option>`
).join("");

export const genMobileBottomBarSettingHTML = () => {
    const title = window.siyuan.languages.mobileBottomBar;
    const disabled = window.siyuan.config.readonly || window.siyuan.isPublish ? " disabled" : "";
    const selects = [0, 1, 2, 3, 4].map((slot) => `<label class="mobile-bottom-bar-setting__slot">
        <span>${slot + 1}</span>
        <select class="b3-select fn__flex-1" data-bottom-bar-slot="${slot}" aria-label="${escapeAttr(`${title} ${slot + 1}`)}"${disabled}>${genBottomBarOptions()}</select>
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
    let config = getBottomBarConfig();
    const syncSelects = () => {
        settingElement.querySelectorAll<HTMLSelectElement>("[data-bottom-bar-slot]").forEach((selectElement) => {
            const slot = Number(selectElement.dataset.bottomBarSlot) as MobileBottomBarSlot;
            selectElement.value = config.actions[slot];
        });
    };
    settingElement.addEventListener("change", (event) => {
        const selectElement = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-bottom-bar-slot]");
        if (!selectElement) {
            return;
        }
        const slot = Number(selectElement.dataset.bottomBarSlot);
        const action = selectElement.value as MobileBottomBarAction;
        if (![0, 1, 2, 3, 4].includes(slot) || !MOBILE_BOTTOM_BAR_ACTIONS.includes(action)) {
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
    syncSelects();
};
