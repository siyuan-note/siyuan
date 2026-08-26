import {Constants} from "../../constants";
import {setStorageVal} from "../../protyle/util/compatibility";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {
    getMobilePluginDockEntries,
    getMobilePluginDockLayouts,
    MOBILE_PLUGIN_DOCKS_CHANGE_EVENT,
    type IMobilePluginDockEntry,
} from "../dock/pluginDockState";
import {
    isMobileSidePanelBuiltInDockId,
    MOBILE_SIDE_PANEL_CONFIG_CHANGE_EVENT,
    normalizeMobileSidePanelConfig,
    reduceMobileSidePanelConfig,
    type IMobileSidePanelConfig,
    type IMobileSidePanelPluginDock,
    type MobileSidePanelBuiltInDockId,
    type MobileSidePanelDockId,
    type MobileSidePanelSide,
} from "./mobileSidePanelConfig";

let pluginDocksChangeHandler: (() => void) | undefined;

const getBuiltInDockLabel = (dockId: MobileSidePanelBuiltInDockId) => {
    switch (dockId) {
        case "file":
            return window.siyuan.languages.fileTree;
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
    }
};

const getBuiltInDockIcon = (dockId: MobileSidePanelBuiltInDockId) => {
    switch (dockId) {
        case "file":
            return "iconFiles";
        case "outline":
            return "iconOutline";
        case "bookmark":
            return "iconBookmark";
        case "tag":
            return "iconTag";
        case "backlink":
            return "iconLink";
        case "inbox":
            return "iconInbox";
        case "agent":
            return "iconSparkles";
    }
};

const getPluginDockContext = () => {
    const entries = getMobilePluginDockEntries();
    return {
        entriesById: new Map(entries.map(entry => [entry.type, entry])),
        layouts: getMobilePluginDockLayouts(entries),
    };
};

export const getMobileSidePanelConfig = (
    pluginDocks: readonly IMobileSidePanelPluginDock[] = getMobilePluginDockLayouts(),
): IMobileSidePanelConfig => {
    return normalizeMobileSidePanelConfig(
        window.siyuan.storage[Constants.LOCAL_MOBILE_SIDE_PANEL], pluginDocks);
};

export const dispatchMobileSidePanelConfigChange = () => {
    window.dispatchEvent(new CustomEvent(MOBILE_SIDE_PANEL_CONFIG_CHANGE_EVENT));
};

export const saveMobileSidePanelConfig = (
    value: unknown,
    pluginDocks: readonly IMobileSidePanelPluginDock[] = getMobilePluginDockLayouts(),
): IMobileSidePanelConfig => {
    const config = normalizeMobileSidePanelConfig(value, pluginDocks);
    window.siyuan.storage[Constants.LOCAL_MOBILE_SIDE_PANEL] = config;
    setStorageVal(Constants.LOCAL_MOBILE_SIDE_PANEL, config);
    dispatchMobileSidePanelConfigChange();
    return config;
};

const getVisibleDockIds = (
    config: IMobileSidePanelConfig,
    side: MobileSidePanelSide,
    pluginEntriesById: ReadonlyMap<string, IMobilePluginDockEntry>,
) => config[side].filter(id => isMobileSidePanelBuiltInDockId(id) || pluginEntriesById.has(id));

const genDockItemHtml = (
    dockId: MobileSidePanelDockId,
    side: MobileSidePanelSide,
    index: number,
    length: number,
    pluginEntriesById: ReadonlyMap<string, IMobilePluginDockEntry>,
) => {
    const pluginEntry = pluginEntriesById.get(dockId);
    const label = isMobileSidePanelBuiltInDockId(dockId) ? getBuiltInDockLabel(dockId) : pluginEntry?.config.title;
    const icon = isMobileSidePanelBuiltInDockId(dockId) ? getBuiltInDockIcon(dockId) : pluginEntry?.config.icon;
    if (!label || !icon) {
        return "";
    }
    const moveLabel = side === "left" ? window.siyuan.languages.moveToRight : window.siyuan.languages.moveToLeft;
    const moveIcon = side === "left" ? "iconRight" : "iconLeft";
    const disabled = window.siyuan.config.readonly || window.siyuan.isPublish;
    return `<div class="b3-list-item" data-dock-id="${escapeAttr(dockId)}">
    <svg class="b3-list-item__graphic"><use xlink:href="#${escapeAttr(icon)}"></use></svg>
    <span class="b3-list-item__text">${escapeHtml(label)}</span>
    <button class="block__icon block__icon--show ariaLabel" data-action="up" data-position="north" aria-label="${escapeAttr(window.siyuan.languages.up)}" type="button"${disabled || index === 0 ? " disabled" : ""}><svg><use xlink:href="#iconUp"></use></svg></button>
    <button class="block__icon block__icon--show ariaLabel" data-action="down" data-position="north" aria-label="${escapeAttr(window.siyuan.languages.down)}" type="button"${disabled || index === length - 1 ? " disabled" : ""}><svg><use xlink:href="#iconDown"></use></svg></button>
    <button class="block__icon block__icon--show ariaLabel" data-action="move" data-position="north" aria-label="${escapeAttr(moveLabel)}" type="button"${disabled || length === 1 ? " disabled" : ""}><svg><use xlink:href="#${moveIcon}"></use></svg></button>
</div>`;
};

const genSideHtml = (
    config: IMobileSidePanelConfig,
    side: MobileSidePanelSide,
    pluginEntriesById: ReadonlyMap<string, IMobilePluginDockEntry>,
) => {
    const label = side === "left" ? window.siyuan.languages.marginLeft : window.siyuan.languages.marginRight;
    const dockIds = getVisibleDockIds(config, side, pluginEntriesById);
    return `<div class="b3-label__text">${escapeHtml(label)}</div>
<div class="b3-list b3-list--background" data-side="${side}">${dockIds.map((dockId, index) =>
        genDockItemHtml(dockId, side, index, dockIds.length, pluginEntriesById)).join("")}</div>`;
};

const genMobileSidePanelListsHtml = (
    config: IMobileSidePanelConfig,
    pluginEntriesById: ReadonlyMap<string, IMobilePluginDockEntry>,
) => {
    return `${genSideHtml(config, "left", pluginEntriesById)}<div class="fn__hr"></div>${
        genSideHtml(config, "right", pluginEntriesById)}`;
};

export const genMobileSidePanelSettingHTML = () => {
    const disabled = window.siyuan.config.readonly || window.siyuan.isPublish ? " disabled" : "";
    const pluginDockContext = getPluginDockContext();
    const config = getMobileSidePanelConfig(pluginDockContext.layouts);
    return `<div id="mobileSidePanelSetting" class="b3-label config-item">
    <div class="fn__flex">
        <div class="fn__flex-1 config-item__main"><div class="config-name">${escapeHtml(window.siyuan.languages.leftRightLayout)}</div></div>
        <button class="b3-button b3-button--outline" data-action="reset" type="button"${disabled}>
            <svg><use xlink:href="#iconUndo"></use></svg>${escapeHtml(window.siyuan.languages.reset)}
        </button>
    </div>
    <div class="fn__hr"></div>
    <div data-type="side-panel-lists">${genMobileSidePanelListsHtml(config, pluginDockContext.entriesById)}</div>
</div>`;
};

export const mountMobileSidePanelSetting = (root: HTMLElement) => {
    const settingElement = root.querySelector<HTMLElement>("#mobileSidePanelSetting");
    const listsElement = settingElement?.querySelector<HTMLElement>('[data-type="side-panel-lists"]');
    if (!settingElement || !listsElement) {
        return;
    }
    let pluginDockContext = getPluginDockContext();
    let config = getMobileSidePanelConfig(pluginDockContext.layouts);
    const render = () => {
        listsElement.innerHTML = genMobileSidePanelListsHtml(config, pluginDockContext.entriesById);
    };
    render();
    settingElement.addEventListener("click", (event) => {
        const actionElement = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
        if (!actionElement || actionElement.disabled) {
            return;
        }
        if (actionElement.dataset.action === "reset") {
            config = saveMobileSidePanelConfig(
                reduceMobileSidePanelConfig(config, {type: "reset"}, pluginDockContext.layouts),
                pluginDockContext.layouts);
            render();
            return;
        }
        const itemElement = actionElement.closest<HTMLElement>("[data-dock-id]");
        const sideElement = actionElement.closest<HTMLElement>("[data-side]");
        const dockId = itemElement?.dataset.dockId;
        const side = sideElement?.dataset.side as MobileSidePanelSide;
        const visibleDockIds = config[side] ? getVisibleDockIds(config, side, pluginDockContext.entriesById) : [];
        const index = dockId ? visibleDockIds.indexOf(dockId) : -1;
        if (!dockId || index < 0) {
            return;
        }
        if (actionElement.dataset.action === "move") {
            config = reduceMobileSidePanelConfig(config, {
                type: "move",
                id: dockId,
                side: side === "left" ? "right" : "left",
            }, pluginDockContext.layouts);
        } else if (actionElement.dataset.action === "up" || actionElement.dataset.action === "down") {
            config = reduceMobileSidePanelConfig(config, {
                type: "reorder",
                side,
                fromIndex: index,
                toIndex: index + (actionElement.dataset.action === "up" ? -1 : 1),
            }, pluginDockContext.layouts);
        } else {
            return;
        }
        config = saveMobileSidePanelConfig(config, pluginDockContext.layouts);
        render();
    });
    const onPluginDocksChange = () => {
        if (!settingElement.isConnected) {
            window.removeEventListener(MOBILE_PLUGIN_DOCKS_CHANGE_EVENT, onPluginDocksChange);
            if (pluginDocksChangeHandler === onPluginDocksChange) {
                pluginDocksChangeHandler = undefined;
            }
            return;
        }
        pluginDockContext = getPluginDockContext();
        config = getMobileSidePanelConfig(pluginDockContext.layouts);
        render();
    };
    if (pluginDocksChangeHandler) {
        window.removeEventListener(MOBILE_PLUGIN_DOCKS_CHANGE_EVENT, pluginDocksChangeHandler);
    }
    pluginDocksChangeHandler = onPluginDocksChange;
    window.addEventListener(MOBILE_PLUGIN_DOCKS_CHANGE_EVENT, onPluginDocksChange);
};
