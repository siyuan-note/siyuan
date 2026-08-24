import {Constants} from "../../constants";
import {setStorageVal} from "../../protyle/util/compatibility";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {
    MOBILE_SIDE_PANEL_CONFIG_CHANGE_EVENT,
    normalizeMobileSidePanelConfig,
    reduceMobileSidePanelConfig,
    type IMobileSidePanelConfig,
    type MobileSidePanelDockId,
    type MobileSidePanelSide,
} from "./mobileSidePanelConfig";

const getDockLabel = (dockId: MobileSidePanelDockId) => {
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

const getDockIcon = (dockId: MobileSidePanelDockId) => {
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

export const getMobileSidePanelConfig = (): IMobileSidePanelConfig => {
    return normalizeMobileSidePanelConfig(window.siyuan.storage[Constants.LOCAL_MOBILE_SIDE_PANEL]);
};

export const dispatchMobileSidePanelConfigChange = () => {
    window.dispatchEvent(new CustomEvent(MOBILE_SIDE_PANEL_CONFIG_CHANGE_EVENT));
};

export const saveMobileSidePanelConfig = (value: unknown): IMobileSidePanelConfig => {
    const config = normalizeMobileSidePanelConfig(value);
    window.siyuan.storage[Constants.LOCAL_MOBILE_SIDE_PANEL] = config;
    setStorageVal(Constants.LOCAL_MOBILE_SIDE_PANEL, config);
    dispatchMobileSidePanelConfigChange();
    return config;
};

const genDockItemHtml = (
    dockId: MobileSidePanelDockId,
    side: MobileSidePanelSide,
    index: number,
    length: number,
) => {
    const moveLabel = side === "left" ? window.siyuan.languages.moveToRight : window.siyuan.languages.moveToLeft;
    const moveIcon = side === "left" ? "iconRight" : "iconLeft";
    const disabled = window.siyuan.config.readonly || window.siyuan.isPublish;
    return `<div class="b3-list-item" data-dock-id="${dockId}">
    <svg class="b3-list-item__graphic"><use xlink:href="#${getDockIcon(dockId)}"></use></svg>
    <span class="b3-list-item__text">${escapeHtml(getDockLabel(dockId))}</span>
    <button class="block__icon block__icon--show ariaLabel" data-action="up" data-position="north" aria-label="${escapeAttr(window.siyuan.languages.up)}" type="button"${disabled || index === 0 ? " disabled" : ""}><svg><use xlink:href="#iconUp"></use></svg></button>
    <button class="block__icon block__icon--show ariaLabel" data-action="down" data-position="north" aria-label="${escapeAttr(window.siyuan.languages.down)}" type="button"${disabled || index === length - 1 ? " disabled" : ""}><svg><use xlink:href="#iconDown"></use></svg></button>
    <button class="block__icon block__icon--show ariaLabel" data-action="move" data-position="north" aria-label="${escapeAttr(moveLabel)}" type="button"${disabled || length === 1 ? " disabled" : ""}><svg><use xlink:href="#${moveIcon}"></use></svg></button>
</div>`;
};

const genSideHtml = (config: IMobileSidePanelConfig, side: MobileSidePanelSide) => {
    const label = side === "left" ? window.siyuan.languages.marginLeft : window.siyuan.languages.marginRight;
    return `<div class="b3-label__text">${escapeHtml(label)}</div>
<div class="b3-list b3-list--background" data-side="${side}">${config[side].map((dockId, index) =>
        genDockItemHtml(dockId, side, index, config[side].length)).join("")}</div>`;
};

const genMobileSidePanelListsHtml = (config: IMobileSidePanelConfig) => {
    return `${genSideHtml(config, "left")}<div class="fn__hr"></div>${genSideHtml(config, "right")}`;
};

export const genMobileSidePanelSettingHTML = () => {
    const disabled = window.siyuan.config.readonly || window.siyuan.isPublish ? " disabled" : "";
    return `<div id="mobileSidePanelSetting" class="b3-label config-item">
    <div class="fn__flex">
        <div class="fn__flex-1 config-item__main"><div class="config-name">${escapeHtml(window.siyuan.languages.leftRightLayout)}</div></div>
        <button class="b3-button b3-button--outline" data-action="reset" type="button"${disabled}>
            <svg><use xlink:href="#iconUndo"></use></svg>${escapeHtml(window.siyuan.languages.reset)}
        </button>
    </div>
    <div class="fn__hr"></div>
    <div data-type="side-panel-lists">${genMobileSidePanelListsHtml(getMobileSidePanelConfig())}</div>
</div>`;
};

export const mountMobileSidePanelSetting = (root: HTMLElement) => {
    const settingElement = root.querySelector<HTMLElement>("#mobileSidePanelSetting");
    const listsElement = settingElement?.querySelector<HTMLElement>('[data-type="side-panel-lists"]');
    if (!settingElement || !listsElement) {
        return;
    }
    let config = getMobileSidePanelConfig();
    const render = () => {
        listsElement.innerHTML = genMobileSidePanelListsHtml(config);
    };
    settingElement.addEventListener("click", (event) => {
        const actionElement = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
        if (!actionElement || actionElement.disabled) {
            return;
        }
        if (actionElement.dataset.action === "reset") {
            config = saveMobileSidePanelConfig(reduceMobileSidePanelConfig(config, {type: "reset"}));
            render();
            return;
        }
        const itemElement = actionElement.closest<HTMLElement>("[data-dock-id]");
        const sideElement = actionElement.closest<HTMLElement>("[data-side]");
        const dockId = itemElement?.dataset.dockId as MobileSidePanelDockId;
        const side = sideElement?.dataset.side as MobileSidePanelSide;
        const index = config[side]?.indexOf(dockId);
        if (index === undefined || index < 0) {
            return;
        }
        if (actionElement.dataset.action === "move") {
            config = reduceMobileSidePanelConfig(config, {
                type: "move",
                id: dockId,
                side: side === "left" ? "right" : "left",
            });
        } else if (actionElement.dataset.action === "up" || actionElement.dataset.action === "down") {
            config = reduceMobileSidePanelConfig(config, {
                type: "reorder",
                side,
                fromIndex: index,
                toIndex: index + (actionElement.dataset.action === "up" ? -1 : 1),
            });
        } else {
            return;
        }
        config = saveMobileSidePanelConfig(config);
        render();
    });
};
