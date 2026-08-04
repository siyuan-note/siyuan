import {popSearch} from "./search";
import {closeModel, closePanel} from "../util/closePanel";
import {mountHelp, newDailyNote, newEncryptedNotebook, newNotebook} from "../../util/mount";
import {exitSiYuan, lockScreen, processSync} from "../../dialog/processSystem";
import {openHistory} from "../../history/history";
import {syncGuide} from "../../sync/syncGuide";
import {openCard} from "../../card/openCard";
import {activeBlur} from "../util/keyboardToolbar";
import {getRecentDocs} from "./getRecentDocs";
import type {App} from "../../index";
import {isInMobileApp} from "../../protyle/util/compatibility";
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

const getSettingTabFromMenuTarget = (target: HTMLElement): ISettingTabShell<TSettingTab> | undefined => {
    const item = target.closest(".b3-menu__item") as HTMLElement | null;
    if (!item?.id) {
        return undefined;
    }
    return getSettingTabDefs().find(def => settingTabToMenuId(def.id) === item.id);
};

const getSettingTabsMenuHTML = () => getSettingTabDefs().map(def =>
    `<div class="b3-menu__item${def.hidden ? " fn__none" : ""}" id="${settingTabToMenuId(def.id)}">
        <svg class="b3-menu__icon"><use xlink:href="#${def.icon}"></use></svg>
        <span class="b3-menu__label">${def.title}</span>
    </div>`).join("");

const openSettingTab = (app: App, settingTabDef: ISettingTabShell<TSettingTab>, returnCallback?: () => void) => {
    openModel({
        title: settingTabDef.title,
        icon: "iconLeft",
        html: `<div class="config${isMobile() ? " config--mobile" : ""}"></div>`,
        bindEvent(modelMainElement: HTMLElement) {
            const root = modelMainElement.firstElementChild as HTMLElement;
            bindSettingSaveDelegation(root);
            void getSettingTab(settingTabDef.id).mount(root, undefined, app);
        },
        backCallback() {
            if (returnCallback) {
                returnCallback();
            } else {
                openSettingMenu(app, "back");
            }
        },
        transition: "forward",
    });
};

const openSettingMenu = (app: App, transition?: "back", returnCallback?: () => void) => {
    openModel({
        title: window.siyuan.languages.config,
        icon: "iconLeft",
        html: `<div class="b3-menu__groups">
    <div class="b3-menu__group">
        <div class="b3-menu__group-items">${getSettingTabsMenuHTML()}</div>
    </div>
</div>`,
        bindEvent(modelMainElement: HTMLElement) {
            modelMainElement.addEventListener("click", (event) => {
                const def = getSettingTabFromMenuTarget(event.target as HTMLElement);
                if (def) {
                    openSettingTab(app, def, () => openSettingMenu(app, "back", returnCallback));
                }
            });
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
    const settingTabDef = tab ? getSettingTabDefs().find(def => def.id === tab) : undefined;
    if (settingTabDef) {
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
    document.getElementById("menu").style.transform = "translateX(0px)";
};

export const initRightMenu = (app: App) => {
    const menuElement = document.getElementById("menu");
    menuElement.innerHTML = `<div class="b3-menu__title">
    <svg class="b3-menu__icon"><use xlink:href="#iconLeft"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.back}</span>
</div>
<div class="b3-menu__items b3-menu__groups">
    <div class="b3-menu__group">
        <div class="b3-menu__group-title">${window.siyuan.languages.mobileMenuQuickActions}</div>
        <div class="b3-menu__group-items">
            <div id="menuRecent" class="b3-menu__item">
                <svg class="b3-menu__icon"><use xlink:href="#iconList"></use></svg><span class="b3-menu__label">${window.siyuan.languages.recentDocs}</span>
            </div>
            <div id="menuSearch" class="b3-menu__item">
                <svg class="b3-menu__icon"><use xlink:href="#iconSearch"></use></svg><span class="b3-menu__label">${window.siyuan.languages.search}</span>
            </div>
            <div id="menuAgentChat" class="b3-menu__item${window.siyuan.config.readonly || window.siyuan.isPublish ? " fn__none" : ""}">
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
        </div>
    </div>
    <div class="b3-menu__group">
        <div class="b3-menu__group-title">${window.siyuan.languages.mobileMenuSettingsAndHelp}</div>
        <div class="b3-menu__group-items">
            <div class="b3-menu__item" id="menuSettings">
                <svg class="b3-menu__icon"><use xlink:href="#iconSettings"></use></svg><span class="b3-menu__label">${window.siyuan.languages.config}</span>
            </div>
            <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuHelp">
                <svg class="b3-menu__icon"><use xlink:href="#iconHelp"></use></svg><span class="b3-menu__label">${window.siyuan.languages.userGuide}</span>
            </div>
            <a class="b3-menu__item" href="${"zh-CN" === window.siyuan.config.lang || "zh-TW" === window.siyuan.config.lang ? "https://ld246.com/article/1649901726096" : "https://liuyun.io/article/1686530886208"}" target="_blank">
                <svg class="b3-menu__icon"><use xlink:href="#iconFeedback"></use></svg>
                <span class="b3-menu__label">${window.siyuan.languages.feedback}</span>
            </a>
        </div>
    </div>
</div>`;
    window.siyuan.mobile.agentChatController?.refreshStatus();
    processSync();
    afterLayoutReady(app);
    // 只能用 click，否则无法上下滚动 https://github.com/siyuan-note/siyuan/issues/6628
    menuElement.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(menuElement)) {
            if (target.classList.contains("b3-menu__title")) {
                closePanel();
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
                syncGuide();
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
                lockScreen(app);
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
            } else if (target.id === "menuSettings") {
                openMobileSetting(app);
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
