import type {App} from "../../index";
import {popSearch} from "./search";
import {getRecentDocs} from "./getRecentDocs";
import {closePanel} from "../util/closePanel";
import {openDock} from "../dock/util";
import {getCurrentEditor} from "../editor";
import {newFile} from "../../util/newFile";
import {mountHelp, newDailyNote, newEncryptedNotebook, newNotebook} from "../../util/mount";
import {exitSiYuan, lockScreen} from "../../dialog/processSystem";
import {openHistory} from "../../history/history";
import {openCard} from "../../card/openCard";
import {syncGuide} from "../../sync/syncGuide";
import {commandPanel} from "../../boot/globalEvent/command/panel";
import {openTopBarMenu} from "../../plugin/openTopBarMenu";
import {openDataMigration} from "../../menus/dataMigration";
import {openTemplateManager} from "../../template/manager";
import {isDisabledFeature, isInMobileApp} from "../../protyle/util/compatibility";
import {getHostCapabilities} from "../../util/hostCapabilities";
import {escapeAttr} from "../../util/escape";
import {getSettingTabDefs, settingTabToMenuId, type ISettingTabShell, type TSettingTab} from "../../config/setting/tabs";

/** 主菜单条目：标记结构、可见条件与点击行为集中声明，供 HTML 生成与事件分发共用同一份标识符 */
export interface IMobileMainMenuItem {
    id: string;
    icon: string;
    label: () => string;
    /** 返回 true 时该条目带 `fn__none`，搜索时也不参与匹配 */
    hidden?: () => boolean;
    /** 危险操作，追加警示样式 */
    warning?: boolean;
    /** 存在时渲染为 `<a>` 并在新标签页打开 */
    href?: () => string;
    /** 追加在标签之后的固定标记元素 */
    trailingHTML?: string;
    click?: (app: App) => void;
}

/** 由其他模块填充内容的占位槽，渲染为带 `fn__none` 的空元素 */
export type TMobileMainMenuSlot = "settingTabs" | "pluginTopBar" | "pluginDocks";

export type TMobileMainMenuEntry = IMobileMainMenuItem | TMobileMainMenuSlot;

export interface IMobileMainMenuGroup {
    title: () => string;
    hidden?: () => boolean;
    entries: TMobileMainMenuEntry[];
}

const isMobileMainMenuSlot = (entry: TMobileMainMenuEntry): entry is TMobileMainMenuSlot =>
    typeof entry === "string";

const lang = (key: string) => () => window.siyuan.languages[key];
const isReadonly = () => window.siyuan.config.readonly;

const dockItem = (id: string, dockType: string, icon: string, label: () => string): IMobileMainMenuItem => ({
    id,
    icon,
    label,
    click() {
        closePanel();
        openDock(dockType);
    },
});

export const MOBILE_MAIN_MENU_GROUPS: IMobileMainMenuGroup[] = [{
    title: lang("mobileMenuNavigation"),
    entries: [
        dockItem("menuDocuments", "file", "iconFiles", lang("fileTree")),
        {
            id: "menuTabs",
            icon: "iconLayoutGrid",
            label: lang("mobileTabs"),
            click() {
                closePanel();
                document.getElementById("toolbarTabs").dispatchEvent(new CustomEvent("click"));
            },
        },
        dockItem("menuOutline", "outline", "iconOutline", lang("outline")),
        dockItem("menuBookmark", "bookmark", "iconBookmark", lang("bookmark")),
        dockItem("menuTag", "tag", "iconTag", lang("tag")),
        dockItem("menuBacklink", "backlink", "iconLink", lang("backlinks")),
        dockItem("menuInbox", "inbox", "iconInbox", lang("inbox")),
        {
            id: "menuRecent",
            icon: "iconRecentDocs",
            label: lang("recentDocs"),
            click(app) {
                getRecentDocs(app);
            },
        },
        {
            id: "menuSearch",
            icon: "iconSearch",
            label: lang("search"),
            click(app) {
                popSearch(app);
            },
        },
        {
            id: "menuAgentChat",
            icon: "iconSparkles",
            label: lang("agentChat"),
            hidden: () => isReadonly() || window.siyuan.isPublish || isDisabledFeature("ai"),
            trailingHTML: "<span data-type=\"agent-status\" class=\"b3-menu__accelerator fn__none\"></span>",
            click(app) {
                void import("../agent/MobileAgentChat").then(({openMobileAgent}) => openMobileAgent(app));
            },
        },
        {
            id: "menuCommand",
            icon: "iconTerminal",
            label: lang("commandPanel"),
            click(app) {
                closePanel({preserveKeyboard: true});
                commandPanel(app);
            },
        },
        {
            id: "menuTemplateManager",
            icon: "iconMarkdown",
            label: lang("templateManager"),
            hidden: () => isReadonly() || !getHostCapabilities().importExport,
            click() {
                const contextID = getCurrentEditor()?.protyle.block.rootID || "";
                closePanel();
                openTemplateManager(contextID);
            },
        },
        {
            id: "menuCard",
            icon: "iconRiffCard",
            label: lang("spaceRepetition"),
            hidden: isReadonly,
            click(app) {
                openCard(app);
                closePanel();
            },
        },
        {
            id: "menuLock",
            icon: "iconLock",
            label: lang("lockScreen"),
            hidden: isReadonly,
            click() {
                lockScreen();
            },
        },
        {
            id: "menuSafeQuit",
            icon: "iconQuit",
            label: lang("safeQuit"),
            hidden: () => !isInMobileApp(),
            warning: true,
            click() {
                exitSiYuan();
            },
        },
    ],
}, {
    title: lang("mobileMenuCreate"),
    hidden: isReadonly,
    entries: [{
        id: "menuNewDoc",
        icon: "iconAddDoc",
        label: lang("newFile"),
        click(app) {
            newFile(app);
            closePanel();
        },
    }, {
        id: "menuNewDaily",
        icon: "iconCalendar",
        label: lang("dailyNote"),
        click(app) {
            newDailyNote(app);
            closePanel();
        },
    }, {
        id: "menuNewNotebook",
        icon: "iconNewNoteBook",
        label: lang("newNotebook"),
        click() {
            newNotebook();
            closePanel();
        },
    }, {
        id: "menuNewEncryptedNotebook",
        icon: "iconLock",
        label: lang("newEncryptedNotebook"),
        hidden: () => !window.siyuan.config.notebookCrypto?.enabled,
        click() {
            newEncryptedNotebook();
            closePanel();
        },
    }],
}, {
    title: lang("mobileMenuDataManagement"),
    hidden: isReadonly,
    entries: [{
        id: "menuSyncNow",
        icon: "iconCloudSucc",
        label: lang("syncNow"),
        click(app) {
            syncGuide(app);
        },
    }, {
        id: "menuHistory",
        icon: "iconHistory",
        label: lang("dataHistory"),
        click(app) {
            openHistory(app);
        },
    }, {
        id: "menuImport",
        icon: "iconDatabaseBackup",
        label: lang("dataMigration"),
        click() {
            closePanel();
            openDataMigration();
        },
    }],
}, {
    title: lang("extensions"),
    entries: [{
        id: "menuPlugin",
        icon: "iconPlugin",
        label: lang("plugin"),
        click(app) {
            openTopBarMenu(app);
        },
    }, "pluginTopBar", "pluginDocks"],
}, {
    title: lang("mobileMenuSettingsAndHelp"),
    entries: ["settingTabs", {
        id: "menuHelp",
        icon: "iconHelp",
        label: lang("userGuide"),
        hidden: isReadonly,
        click() {
            mountHelp();
        },
    }, {
        id: "menuFeedback",
        icon: "iconFeedback",
        label: lang("feedback"),
        href: () => "zh-CN" === window.siyuan.config.lang ?
            "https://ld246.com/article/1649901726096" : "https://liuyun.io/article/1686530886208",
    }],
}];

/** 按条目 ID 取点击处理函数，未登记的 ID 返回 undefined */
export const getMobileMainMenuHandler = (id: string) => {
    for (const group of MOBILE_MAIN_MENU_GROUPS) {
        for (const entry of group.entries) {
            if (!isMobileMainMenuSlot(entry) && entry.id === id) {
                return entry.click;
            }
        }
    }
    return undefined;
};

export const getSettingTabFromMenuTarget = (target: HTMLElement): ISettingTabShell<TSettingTab> | undefined => {
    const item = target.closest(".b3-menu__item") as HTMLElement | null;
    const tabId = item?.dataset.name;
    if (item?.dataset.type !== "setting-tab" || !tabId) {
        return undefined;
    }
    return getSettingTabDefs().find(def => def.id === tabId);
};

const getSettingTabsMenuHTML = () => getSettingTabDefs().map(def =>
    `<div class="b3-menu__item${def.hidden ? " fn__none" : ""}" id="${settingTabToMenuId(def.id)}" data-type="setting-tab" data-name="${def.id}">
        <svg class="b3-menu__icon"><use xlink:href="#${def.icon}"></use></svg>
        <span class="b3-menu__label">${def.title}</span>
    </div>`).join("");

const getSettingTabResultsHTML = () => getSettingTabDefs().map(def =>
    `<div class="config mobile-setting-menu__result fn__none" data-name="${def.id}"></div>`).join("");

const renderMobileMainMenuEntryHTML = (entry: TMobileMainMenuEntry) => {
    if (isMobileMainMenuSlot(entry)) {
        if (entry === "settingTabs") {
            return getSettingTabsMenuHTML();
        }
        const id = entry === "pluginTopBar" ? "menuPluginTopBar" : "menuPluginDocks";
        return `<div id="${id}" class="fn__none"></div>`;
    }
    const className = ["b3-menu__item"];
    if (entry.warning) {
        className.push("b3-menu__item--warning");
    }
    if (entry.hidden?.()) {
        className.push("fn__none");
    }
    const contentHTML = `<svg class="b3-menu__icon"><use xlink:href="#${entry.icon}"></use></svg>` +
        `<span class="b3-menu__label">${entry.label()}</span>${entry.trailingHTML ?? ""}`;
    if (entry.href) {
        return `<a id="${entry.id}" class="${className.join(" ")}" href="${entry.href()}" target="_blank">${contentHTML}</a>`;
    }
    return `<div id="${entry.id}" class="${className.join(" ")}">${contentHTML}</div>`;
};

const renderMobileMainMenuGroupHTML = (group: IMobileMainMenuGroup) =>
    `<div class="b3-menu__group${group.hidden?.() ? " fn__none" : ""}">
        <div class="b3-menu__group-title">${group.title()}</div>
        <div class="b3-menu__group-items">${group.entries.map(renderMobileMainMenuEntryHTML).join("")}</div>
    </div>`;

/** 生成主菜单容器 `#menu` 的内容，分组与条目均由 `MOBILE_MAIN_MENU_GROUPS` 推导 */
export const renderMobileMainMenuHTML = () => `<div class="b3-menu__title">
    <svg class="b3-menu__icon" role="img" aria-label="${escapeAttr(window.siyuan.languages.returnLabel)}"><use xlink:href="#iconLeft"></use></svg>
</div>
<div class="mobile-main-menu__search" data-prevent-swipe>
    <input placeholder="${window.siyuan.languages.searchPlaceholder}" class="b3-text-field fn__block" autocomplete="off" autocorrect="off" spellcheck="false">
</div>
<div class="b3-menu__items b3-menu__groups mobile-main-menu__groups">
    ${MOBILE_MAIN_MENU_GROUPS.map(renderMobileMainMenuGroupHTML).join("")}
    <div class="b3-list--empty fn__none" data-type="menu-search-empty">${window.siyuan.languages.emptyContent}</div>
    ${getSettingTabResultsHTML()}
</div>`;
