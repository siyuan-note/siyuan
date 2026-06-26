import {editorConfigApi} from "../tabs/editorRuntime";
import {fileConfigApi} from "../tabs/fileRuntime";
import {flashcardConfigApi} from "../tabs/flashcardRuntime";
import {aiConfigApi} from "../tabs/aiRuntime";
import {secretsConfigApi} from "../tabs/secretsVariablesRuntime";
import {exportConfigApi} from "../tabs/exportRuntime";
import {searchConfigApi} from "../tabs/searchRuntime";
import {appearanceConfigApi} from "../tabs/appearanceRuntime";
import {mountSyncTabExtras, patchSyncConfig} from "../tabs/syncRuntime";
import {mountAccessTab} from "../tabs/accessRuntime";
import {collectAssetsTabSearchStrings, mountAssetsTab} from "../assets";
/// #if !MOBILE
import {collectBazaarTabSearchStrings, mountBazaarTab} from "../bazaar";
import {collectKeymapTabSearchStrings, mountKeymapTab} from "../tabs/keymapUi";
/// #endif
import {isHuawei, isInHarmony} from "../../protyle/util/compatibility";
/// #if MOBILE
import {isDisabledFeature} from "../../protyle/util/compatibility";
/// #endif
import {SettingBuilder, type SettingTab} from "./builder";
import {registerEditorTab} from "../tabs/editorTab";
import {registerFileTab} from "../tabs/fileTab";
import {registerFlashcardTab} from "../tabs/flashcardTab";
import {registerAiTab} from "../tabs/aiTab";
import {registerSecretsVariablesTab} from "../tabs/secretsVariablesTab";
import {registerExportTab} from "../tabs/exportTab";
import {registerSearchTab} from "../tabs/searchTab";
import {registerAppearanceTab} from "../tabs/appearanceTab";
import {registerSyncTab} from "../tabs/syncTab";
import {registerAccessTab} from "../tabs/accessTab";
import {registerAppTab} from "../tabs/appTab";
import {registerAboutTab} from "../tabs/aboutTab";

const setting = new SettingBuilder();
const settingTabs = {
    editor: setting.tab({
        id: "editor",
        icon: "iconEdit",
        title: () => window.siyuan.languages.editor,
        defaultSave: editorConfigApi.patch,
    }, registerEditorTab),
    file: setting.tab({
        id: "file",
        icon: "iconFiles",
        title: () => window.siyuan.languages.fileTree,
        defaultSave: fileConfigApi.patch,
    }, registerFileTab),
    appearance: setting.tab({
        id: "appearance",
        icon: "iconTheme",
        title: () => window.siyuan.languages.appearance,
        defaultSave: appearanceConfigApi.patch,
    }, registerAppearanceTab),
    /// #if !MOBILE
    bazaar: setting.panel({
        id: "bazaar",
        icon: "iconBazaar",
        title: () => window.siyuan.languages.bazaar,
        hidden: () => !!(isHuawei() || isInHarmony()),
        searchStrings: collectBazaarTabSearchStrings,
        mount: mountBazaarTab,
    }),
    /// #endif
    flashcard: setting.tab({
        id: "flashcard",
        icon: "iconRiffCard",
        title: () => window.siyuan.languages.riffCard,
        defaultSave: flashcardConfigApi.patch,
    }, registerFlashcardTab),
    ai: setting.tab({
        id: "ai",
        icon: "iconSparkles",
        title: () => window.siyuan.languages.ai,
        defaultSave: aiConfigApi.patch,
        /// #if MOBILE
        hidden: () => isHuawei() || isDisabledFeature("ai"),
        /// #endif
    }, registerAiTab),
    secretsVariables: setting.tab({
        id: "secretsVariables",
        icon: "iconSquareAsterisk",
        title: () => window.siyuan.languages.secretsVariables,
        defaultSave: secretsConfigApi.patch,
    }, registerSecretsVariablesTab),
    assets: setting.panel({
        id: "assets",
        icon: "iconImage",
        title: () => window.siyuan.languages.assets,
        searchStrings: collectAssetsTabSearchStrings,
        mount: mountAssetsTab,
    }),
    export: setting.tab({
        id: "export",
        icon: "iconUpload",
        title: () => window.siyuan.languages.export,
        defaultSave: exportConfigApi.patch,
    }, registerExportTab),
    search: setting.tab({
        id: "search",
        icon: "iconSearch",
        title: () => window.siyuan.languages.search,
        defaultSave: searchConfigApi.patch,
    }, registerSearchTab),
    /// #if !MOBILE
    keymap: setting.panel({
        id: "keymap",
        icon: "iconKeymap",
        title: () => window.siyuan.languages.keymap,
        searchStrings: collectKeymapTabSearchStrings,
        mount: mountKeymapTab,
    }),
    /// #endif
    sync: setting.tab({
        id: "sync",
        icon: "iconCloud",
        title: () => window.siyuan.languages.accountSync,
        defaultSave: patchSyncConfig,
        afterMount: mountSyncTabExtras,
    }, registerSyncTab),
    access: setting.tab({
        id: "access",
        icon: "iconLock",
        title: () => window.siyuan.languages.authentication,
        afterMount: mountAccessTab,
    }, registerAccessTab),
    app: setting.tab({
        id: "app",
        icon: "iconLayoutGrid",
        title: () => window.siyuan.languages.application,
    }, registerAppTab),
    about: setting.tab({
        id: "about",
        icon: "iconInfo",
        title: () => window.siyuan.languages.about,
    }, registerAboutTab),
};

export type TSettingTab = keyof typeof settingTabs;

export const getSettingTab = (id: TSettingTab): SettingTab => settingTabs[id];

export interface ISettingTabShell<TId extends string = string> {
    id: TId;
    icon: string;
    title: string;
    hidden?: boolean;
}

let settingTabShellCache: ISettingTabShell<TSettingTab>[] | undefined;

export const getSettingTabDefs = (): ISettingTabShell<TSettingTab>[] => {
    if (settingTabShellCache) {
        return settingTabShellCache;
    }
    settingTabShellCache = (Object.entries(settingTabs) as [TSettingTab, SettingTab][]).map(([id, tab]) => ({
        id,
        icon: tab.icon,
        title: tab.title(),
        hidden: tab.hidden?.(),
    }));
    return settingTabShellCache;
};

/** 移动端侧栏中设置标签页菜单项的 DOM `id` */
export const settingTabToMenuId = (tabId: string): string =>
    "menuConfig" + tabId[0].toUpperCase() + tabId.slice(1);
