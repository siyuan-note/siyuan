/// #if MOBILE
import {popMenu} from "../mobile/menu";
/// #else
import {initSettingSearch, switchSettingTab} from "./search/dialog";
import {bindSettingSaveDelegation} from "./setting/save";
import {Dialog} from "../dialog";
import {Constants} from "../constants";
import {focusByRange} from "../protyle/util/selection";
/// #endif
import type {TSettingTab} from "./setting/tabs";
import {getSettingTabDefs} from "./setting/tabs";
import {clearAccessTabElement} from "./tabs/accessRuntime";
import {clearSyncTabElement} from "./tabs/syncRuntime";
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
            <div class="b3-form__icon">
                <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
                <input placeholder="${window.siyuan.languages.search}" class="b3-text-field fn__block b3-form__icon-input">
            </div>
        </div>
        <ul class="config__tab-scroll">
            ${tabListItems.join("")}
        </ul>
    </div>
    <div class="config__tab-wrap">
        ${tabPanels.join("")}
    </div>
</div>`,
        width: "70vw",
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
    /// #else
    return openSettingDialog(app, tab);
    /// #endif
};
