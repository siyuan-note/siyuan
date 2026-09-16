import {closeModel, closePanel, MOBILE_MENU_CLOSE_EVENT} from "../util/closePanel";
import {activeBlur} from "../util/keyboardToolbar";
import type {App} from "../../index";
import {getSettingTabDefs, type TSettingTab} from "../../config/setting/tabs";
import {getSettingTabFromMenuTarget, getMobileMainMenuHandler, renderMobileMainMenuHTML} from "./mainMenu";
import {createMainMenuSearch, type IMainMenuSearch} from "./mainMenuSearch";
import {openSettingTab} from "./settingPanel";
import {getCurrentEditor} from "../editor";
import {getMobilePluginDockEntries, MOBILE_PLUGIN_DOCKS_CHANGE_EVENT} from "../dock/pluginDockState";
import {openDock} from "../dock/util";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {processSync} from "../../dialog/processSystem";
import {afterLayoutReady} from "../../plugin/loader";

let mobileMenuReturnCallback: (() => void) | undefined;

const takeMobileMenuReturnCallback = () => {
    const callback = mobileMenuReturnCallback;
    mobileMenuReturnCallback = undefined;
    return callback;
};

export const openMobileSetting = (app: App, tab?: TSettingTab, returnCallback?: () => void) => {
    if (!tab) {
        popMenu();
        if (document.getElementById("menu")?.style.transform === "translateX(0px)") {
            mobileMenuReturnCallback = returnCallback;
        }
        return;
    }
    const callback = returnCallback || takeMobileMenuReturnCallback();
    activeBlur();
    document.getElementById("menu")?.dispatchEvent(new CustomEvent(MOBILE_MENU_CLOSE_EVENT));
    const settingTabDef = getSettingTabDefs().find(def => def.id === tab);
    if (!settingTabDef || settingTabDef.hidden) {
        return;
    }
    openSettingTab(app, settingTabDef, callback);
};

export const popMenu = () => {
    mobileMenuReturnCallback = undefined;
    if (getCurrentEditor()?.protyle.toolbar.isMultiSelectMode()) {
        return;
    }
    activeBlur();
    closePanel();
    const menuElement = document.getElementById("menu");
    menuElement.style.zIndex = (++window.siyuan.zIndex).toString();
    menuElement.style.transform = "translateX(0px)";
};

/** 重新生成插件停靠栏条目，由 `#menuPluginDocks` 占位元素定位 */
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

/** 分发单层元素的点击：handled 表示已响应，ignored 表示继续向上查找，abort 表示终止本次事件处理 */
const dispatchMobileMainMenuClick = (app: App, target: HTMLElement, search: IMainMenuSearch):
    "handled" | "ignored" | "abort" => {
    if (target.classList.contains("b3-menu__title")) {
        closePanel();
        return "handled";
    }
    const settingTabDef = getSettingTabFromMenuTarget(target);
    if (settingTabDef) {
        if (search.keywords()) {
            // 搜索态下点击设置项只就地展开结果，无匹配时不响应本次点击
            return search.selectSettingTab(settingTabDef.id) ? "handled" : "abort";
        }
        openSettingTab(app, settingTabDef, takeMobileMenuReturnCallback() || closeModel);
        return "handled";
    }
    if (target.dataset.type === "mobile-plugin-dock") {
        const pluginDockEntry = getMobilePluginDockEntries(app)
            .find(entry => entry.key === target.dataset.pluginDockKey);
        closePanel();
        if (pluginDockEntry) {
            openDock(pluginDockEntry.type);
        }
        return "handled";
    }
    const handler = getMobileMainMenuHandler(target.id);
    if (handler) {
        handler(app);
        return "handled";
    }
    return "ignored";
};

export const initRightMenu = (app: App) => {
    const menuElement = document.getElementById("menu");
    menuElement.innerHTML = renderMobileMainMenuHTML();
    renderMobilePluginDockMenu(app, menuElement);
    window.addEventListener(MOBILE_PLUGIN_DOCKS_CHANGE_EVENT, () => {
        renderMobilePluginDockMenu(app, menuElement);
    });
    const search = createMainMenuSearch(app, menuElement);
    menuElement.addEventListener(MOBILE_MENU_CLOSE_EVENT, (event: CustomEvent<{preserveKeyboard?: boolean}>) => {
        search.reset(event.detail?.preserveKeyboard);
        const callback = takeMobileMenuReturnCallback();
        if (callback) {
            window.setTimeout(callback);
        }
    });
    window.siyuan.mobile.agentChatController?.refreshStatus();
    processSync();
    afterLayoutReady(app);
    // 只能用 click，否则无法上下滚动 https://github.com/siyuan-note/siyuan/issues/6628
    menuElement.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        const topLevelMenuItem = target.closest(".b3-menu__item") as HTMLElement | null;
        if (topLevelMenuItem?.parentElement?.classList.contains("b3-menu__group-items") &&
            topLevelMenuItem.dataset.type !== "setting-tab") {
            mobileMenuReturnCallback = undefined;
        }
        while (target && !target.isEqualNode(menuElement)) {
            const result = dispatchMobileMainMenuClick(app, target, search);
            if (result === "abort") {
                return;
            }
            if (result === "handled") {
                event.preventDefault();
                event.stopPropagation();
                break;
            }
            target = target.parentElement;
        }
    });
};
