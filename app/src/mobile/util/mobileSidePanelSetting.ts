import {Constants} from "../../constants";
import {isDisabledFeature, setStorageVal} from "../../protyle/util/compatibility";
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
) => config[side].filter(id => (id !== "agent" || !isDisabledFeature("ai")) &&
    (isMobileSidePanelBuiltInDockId(id) || pluginEntriesById.has(id)));

const genDockItemHtml = (
    dockId: MobileSidePanelDockId,
    visible: boolean,
    pluginEntriesById: ReadonlyMap<string, IMobilePluginDockEntry>,
) => {
    const pluginEntry = pluginEntriesById.get(dockId);
    const label = isMobileSidePanelBuiltInDockId(dockId) ? getBuiltInDockLabel(dockId) : pluginEntry?.config.title;
    const icon = isMobileSidePanelBuiltInDockId(dockId) ? getBuiltInDockIcon(dockId) : pluginEntry?.config.icon;
    if (!label || !icon) {
        return "";
    }
    const disabled = window.siyuan.config.readonly || window.siyuan.isPublish;
    return `<div class="b3-list-item" data-dock-id="${escapeAttr(dockId)}">
    <span class="block__icon block__icon--show" data-action="drag" style="touch-action: none; cursor: grab; margin-right: 8px;${disabled ? " visibility: hidden;" : ""}"><svg><use xlink:href="#iconDrag"></use></svg></span>
    <svg class="b3-list-item__graphic"><use xlink:href="#${escapeAttr(icon)}"></use></svg>
    <span class="b3-list-item__text">${escapeHtml(label)}</span>
    <input class="b3-switch" type="checkbox" data-action="visibility" aria-label="${escapeAttr(label)}"${visible ? " checked" : ""}${disabled ? " disabled" : ""}>
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
<div class="b3-list b3-list--background" data-side="${side}">${dockIds.map(dockId =>
        genDockItemHtml(dockId, !config.hidden.includes(dockId), pluginEntriesById)).join("")}</div>`;
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
        <div class="fn__flex-1 config-item__main"><div class="config-name">${escapeHtml(window.siyuan.languages.leftRightSidebarLayout)}</div></div>
        <button class="b3-button b3-button--outline" data-action="reset" type="button"${disabled}>
            <svg><use xlink:href="#iconUndo"></use></svg>${escapeHtml(window.siyuan.languages.reset)}
        </button>
    </div>
    <div class="fn__hr"></div>
    <div class="config-side-panel" data-type="side-panel-lists">${genMobileSidePanelListsHtml(config, pluginDockContext.entriesById)}</div>
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
    let dragging: {id: string, pointerId: number, x: number, y: number} | undefined;
    let dropTarget: {side: MobileSidePanelSide, index: number} | undefined;
    const clearDropTarget = () => {
        listsElement.querySelectorAll<HTMLElement>("[data-dock-id]").forEach(item => {
            item.classList.remove("dragover__top", "dragover__bottom");
            item.style.opacity = "";
        });
        dropTarget = undefined;
    };
    const clearDrag = () => {
        dragging = undefined;
        listsElement.classList.remove("config-side-panel--dragging");
        clearDropTarget();
    };
    const render = () => {
        clearDrag();
        listsElement.innerHTML = genMobileSidePanelListsHtml(config, pluginDockContext.entriesById);
    };
    render();
    listsElement.addEventListener("pointerdown", (event: PointerEvent) => {
        const handle = (event.target as Element).closest('[data-action="drag"]');
        if (!handle || event.button !== 0 || !event.isPrimary ||
            window.siyuan.config.readonly || window.siyuan.isPublish) {
            return;
        }
        const item = handle.closest<HTMLElement>("[data-dock-id]");
        dragging = {id: item.dataset.dockId, pointerId: event.pointerId, x: event.clientX, y: event.clientY};
        listsElement.setPointerCapture(event.pointerId);
        listsElement.classList.add("config-side-panel--dragging");
        event.preventDefault();
    });
    listsElement.addEventListener("pointermove", (event: PointerEvent) => {
        if (!dragging || dragging.pointerId !== event.pointerId) {
            return;
        }
        clearDropTarget();
        if (Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y) < 5) {
            return;
        }
        const target = document.elementFromPoint(event.clientX, event.clientY);
        const sideElement = target?.closest<HTMLElement>("[data-side]");
        if (!sideElement || !listsElement.contains(sideElement)) {
            return;
        }
        const side = sideElement.dataset.side as MobileSidePanelSide;
        const sourceSide = config.left.includes(dragging.id) ? "left" : "right";
        const available = (ids: string[]) => ids.filter(id =>
            isMobileSidePanelBuiltInDockId(id) || pluginDockContext.entriesById.has(id));
        if (side !== sourceSide && available(config[sourceSide]).length === 1) {
            return;
        }
        const rows = Array.from(sideElement.querySelectorAll<HTMLElement>("[data-dock-id]"))
            .filter(item => item.dataset.dockId !== dragging.id);
        const next = rows.find(item => event.clientY < item.getBoundingClientRect().top + item.offsetHeight / 2);
        const ids = available(config[side]).filter(id => id !== dragging.id);
        dropTarget = {side, index: next ? ids.indexOf(next.dataset.dockId) : ids.length};
        const marker = next || rows[rows.length - 1];
        if (marker) {
            marker.classList.add(next ? "dragover__top" : "dragover__bottom");
        }
        listsElement.querySelectorAll<HTMLElement>("[data-dock-id]").forEach(item => {
            if (item.dataset.dockId === dragging.id) {
                item.style.opacity = "0.5";
            }
        });
    });
    listsElement.addEventListener("pointerup", (event: PointerEvent) => {
        if (!dragging || dragging.pointerId !== event.pointerId) {
            return;
        }
        if (dropTarget && !window.siyuan.config.readonly && !window.siyuan.isPublish) {
            config = saveMobileSidePanelConfig(reduceMobileSidePanelConfig(config, {
                type: "move", id: dragging.id, ...dropTarget,
            }, pluginDockContext.layouts), pluginDockContext.layouts);
        }
        listsElement.releasePointerCapture(event.pointerId);
        render();
    });
    const cancelDrag = (event: PointerEvent) => {
        if (event.pointerId === dragging?.pointerId) {
            clearDrag();
        }
    };
    listsElement.addEventListener("pointercancel", cancelDrag);
    listsElement.addEventListener("lostpointercapture", cancelDrag);
    settingElement.addEventListener("click", (event) => {
        const actionElement = (event.target as HTMLElement).closest<HTMLButtonElement | HTMLInputElement>("[data-action]");
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
        if (actionElement.dataset.action === "visibility") {
            config = reduceMobileSidePanelConfig(config, {
                type: "visibility",
                id: dockId,
                visible: (actionElement as HTMLInputElement).checked,
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
