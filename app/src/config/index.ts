/// #if MOBILE
import {popMenu} from "../mobile/menu";
/// #else
import {initSettingSearch, switchSettingTab} from "./search/dialog";
import {bindSettingSaveDelegation} from "./setting/save";
import {Dialog} from "../dialog";
import {Constants} from "../constants";
import {focusByRange} from "../protyle/util/selection";
import {bazaar, renderReadme} from "./bazaar";
import {fetchSyncPost} from "../util/fetch";
import {getFrontend} from "../util/functions";
import {showMessage} from "../dialog/message";
import {escapeHtml} from "../util/escape";
/// #endif
import {getSettingTabDefs, settingTabToMenuId} from "./setting/tabs";
import {clearAccessTabElement} from "./tabs/accessRuntime";
import {clearSyncTabElement} from "./tabs/syncRuntime";
import type {TSettingTab} from "./setting/tabs";
import type {App} from "../index";

/// #if !MOBILE
const openSettingDialog = (app: App, initialTab: TSettingTab = "editor") => {
    window.siyuan.dialogs.find((item) => item.element.querySelector(".config__tab-container"))?.destroy();
    let range: Range;
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0);
    }
    const tabListItems: string[] = [];
    const tabPanels: string[] = [];
    for (const def of getSettingTabDefs()) {
        const isActive = def.id === initialTab;
        tabListItems.push(`<li data-name="${def.id}" class="b3-list-item${isActive ? " b3-list-item--focus" : ""}${def.hidden ? " fn__none" : ""}"><svg class="b3-list-item__graphic"><use xlink:href="#${def.icon}"></use></svg><span class="b3-list-item__text">${def.title}</span></li>`);
        tabPanels.push(`<div class="config__tab-container${isActive ? "" : " fn__none"}" data-name="${def.id}"></div>`);
    }
    const dialog = new Dialog({
        content: `<div class="fn__flex-1 fn__flex config__panel" style="overflow: hidden;position: relative">
    <div class="config__side b3-list b3-list--background">
        <div class="config__tab-head">
            <div class="config__tab-title resize__move">
                <svg class="b3-list-item__graphic"><use xlink:href="#iconSettings"></use></svg>
                <span class="b3-list-item__text">${window.siyuan.languages.config}</span>
            </div>
            <input placeholder="${window.siyuan.languages.search}" class="b3-text-field fn__block">
        </div>
        <ul class="config__tab-scroll">
            ${tabListItems.join("")}
        </ul>
    </div>
    <div class="config__tab-wrap">
        ${tabPanels.join("")}
    </div>
</div>`,
        width: "max(70vw, min(90vw, 900px))",
        height: "90vh",
        destroyCallback() {
            clearSyncTabElement();
            clearAccessTabElement();
            if (range) {
                focusByRange(range);
            }
        },
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_SETTING);

    const tabWrap = dialog.element.querySelector(".config__tab-wrap") as HTMLElement;
    bindSettingSaveDelegation(tabWrap);
    initSettingSearch(dialog.element, app);
    (dialog.element.querySelector(".b3-dialog__container") as HTMLElement).style.maxWidth = "1280px";
    dialog.element.querySelectorAll(".config__side .b3-list-item").forEach(item => {
        // 兼容社区 JS 代码片段模拟点击，不做事件委托
        item.addEventListener("click", () => {
            const tabId = item.getAttribute("data-name") as TSettingTab;
            switchSettingTab(dialog.element, app, tabId);
        });
    });
    switchSettingTab(dialog.element, app, initialTab);
    return dialog;
};
/// #endif

export const openSetting = (app: App, tab?: TSettingTab) => {
    /// #if MOBILE
    popMenu();
    if (tab) {
        window.setTimeout(() => {
            document.getElementById(settingTabToMenuId(tab))?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        }, 200);
    }
    /// #else
    return openSettingDialog(app, tab);
    /// #endif
};

export const openBazaarReadme = async (app: App, bazaarType: TBazaarType, itemName: string, from: "bazaar" | "downloaded") => {
    /// #if !MOBILE
    if (!window.siyuan.config.bazaar.trust) {
        openSettingDialog(app, "bazaar");
        return;
    }

    const isDownloaded = from === "downloaded";
    let getResourcesUrl: string;
    switch (bazaarType) {
        case "templates":
            getResourcesUrl = isDownloaded ? "/api/bazaar/getInstalledTemplate" : "/api/bazaar/getBazaarTemplate";
            break;
        case "icons":
            getResourcesUrl = isDownloaded ? "/api/bazaar/getInstalledIcon" : "/api/bazaar/getBazaarIcon";
            break;
        case "widgets":
            getResourcesUrl = isDownloaded ? "/api/bazaar/getInstalledWidget" : "/api/bazaar/getBazaarWidget";
            break;
        case "themes":
            getResourcesUrl = isDownloaded ? "/api/bazaar/getInstalledTheme" : "/api/bazaar/getBazaarTheme";
            break;
        case "plugins":
            getResourcesUrl = isDownloaded ? "/api/bazaar/getInstalledPlugin" : "/api/bazaar/getBazaarPlugin";
            break;
        default:
            return;
    }

    const response = await fetchSyncPost(getResourcesUrl, {
        frontend: getFrontend(),
        // 完整包名作 keyword 可缩小请求响应列表；最终仍按 name 精确匹配
        keyword: itemName,
    });
    if (response.code !== 0) return;

    const resource = (response.data.packages as IBazaarItem[]).find((item: IBazaarItem) => item.name === itemName);
    if (!resource) {
        showMessage(`Package not found: ${escapeHtml(itemName)}`);
        return;
    }

    openSettingDialog(app, "bazaar");
    bazaar.switchBazaarTab(app, bazaarType, from);
    renderReadme(bazaarType, from, resource);
    /// #endif
};
