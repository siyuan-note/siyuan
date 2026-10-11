import {config as configApi} from "../util/configApi";
/// #if MOBILE
import {saveScroll} from "../../protyle/scroll/saveScroll";
/// #else
import {adjustDockPadding} from "../../layout/dock/util";
import {reloadUI as reloadDesktopUI} from "../../layout/util";
import {syncHideToolbarLayout, updateBarModeIcon} from "../../layout/topBar";
/// #endif
import {
    enqueueAppearanceUpdate,
    invalidateAppearancePackages,
    loadAssets,
    markAppearanceReloadPending,
    refreshHeadingNumberMeasurements,
    setBodyHighlight,
    setInlineStyle,
    unloadThemeScript
} from "../../util/assets";
import {getFrontend} from "../../util/functions";
import {getCurrentThemeName, isCurrentThemeSupported, shouldUnloadThemeScript} from "../../util/themeCompatibility";
import {remountOpenSettingTab} from "../setting/mount";
import {createConfigNamespaceApi} from "../util/namespaceApi";
import {createSectionRuntime} from "../util/sectionRuntime";
import {syncBodyGradient} from "./bodyGradient";
import {refreshDynamicIcons} from "../../emoji/dynamicIcon";
import {closeSettingsWindow, isSettingsWindow} from "../setting/windowContext";

/** 主题模式下拉框初值：合并 mode / modeOS */
export const appearanceThemeModeValue = (): number =>
    window.siyuan.config.appearance.modeOS ? 2 : window.siyuan.config.appearance.mode;

/** 主题模式选择：合并 mode / modeOS 后提交 */
export const saveThemeMode = (value: number) => {
    const OSThemeMode = window.matchMedia("(prefers-color-scheme: dark)").matches ? 1 : 0;
    configApi.set("appearance", {
        mode: (value === 2 ? OSThemeMode : value) as Config.IAppearance["mode"],
        modeOS: value === 2,
    });
};

/// #if MOBILE
const reloadUI = async () => {
    if (window.siyuan.mobile.editor) {
        await saveScroll(window.siyuan.mobile.editor.protyle);
    }
    window.location.reload();
};
/// #endif

interface IAppearanceRefresh {
    appearance: Config.IAppearance;
    themes: string[] | null;
    icons: string[] | null;
    revision: string;
}

const applyAppearanceConfig = async (data: Config.IAppearance, refresh?: IAppearanceRefresh) => {
    if (data.lang !== window.siyuan.config.appearance.lang) {
        if (isSettingsWindow()) {
            closeSettingsWindow();
            return;
        }
        markAppearanceReloadPending();
        /// #if MOBILE
        void reloadUI();
        /// #else
        void reloadDesktopUI();
        /// #endif
        return;
    }

    const prevAppearance = window.siyuan.config.appearance;
    const changedPackages = refresh && invalidateAppearancePackages(refresh.themes || [], refresh.icons || [], refresh.revision);
    const themeChanged = changedPackages?.themes.some(name => name === getCurrentThemeName(prevAppearance) ||
        name === getCurrentThemeName(data));
    // 仅更新背景渐变时原位同步控件，避免整页重建期间的布局变化引起滚动抖动。
    // 启动初始化传入当前配置本身，需要完整加载外观资源；重复推送仍使用原位同步。
    const appearanceKeys = Object.keys({...prevAppearance, ...data}) as Array<keyof Config.IAppearance>;
    if (!refresh && prevAppearance !== data &&
        appearanceKeys.every(key => key === "bodyGradient" ||
            JSON.stringify(prevAppearance[key]) === JSON.stringify(data[key]))) {
        window.siyuan.config.appearance = data;
        setBodyHighlight(data.bodyGradient);
        syncBodyGradient();
        return;
    }
    const unloadChangedTheme = themeChanged && prevAppearance.themeJS && isCurrentThemeSupported(prevAppearance, getFrontend());
    if ((unloadChangedTheme || shouldUnloadThemeScript(prevAppearance, data, getFrontend())) && !await unloadThemeScript()) {
        if (closeSettingsWindow()) return;
        markAppearanceReloadPending();
        /// #if MOBILE
        void reloadUI();
        /// #else
        void reloadDesktopUI();
        /// #endif
        return;
    }

    await createSectionRuntime<Config.IAppearance>({
        namespace: "appearance",
        get: () => prevAppearance,
        set: next => { window.siyuan.config.appearance = next; },
        reactions: [{
            name: "bars",
            changed: () => true,
            apply: (old, next) => {
                document.getElementById("status")?.classList.toggle("fn__none", next.hideStatusBar);
                /// #if !MOBILE
                if (!isSettingsWindow() && next.hideStatusBar !== old.hideStatusBar) adjustDockPadding();
                if (!isSettingsWindow() && next.hideToolbar !== old.hideToolbar) syncHideToolbarLayout();
                if (!isSettingsWindow()) updateBarModeIcon();
                /// #endif
            },
        }, {
            name: "appearance-resources",
            changed: () => true,
            apply: async (old, next) => {
                await loadAssets(next);
                if (JSON.stringify(next.globalFontFamilies) !== JSON.stringify(old.globalFontFamilies)) {
                    await setInlineStyle();
                    refreshHeadingNumberMeasurements();
                    refreshDynamicIcons();
                }
                /// #if !MOBILE
                void remountOpenSettingTab("appearance");
                /// #endif
            },
        }],
    }).apply(data);
};

export const refreshAppearance = (data: IAppearanceRefresh) =>
    enqueueAppearanceUpdate(() => applyAppearanceConfig(data.appearance, data));

/** 外观 Tab 命名空间：设置面板注册项 save */
export const appearanceConfigApi = createConfigNamespaceApi<Config.IAppearance>({
    namespace: "appearance",
    getConfig: () => window.siyuan.config.appearance,
    setConfig: data => enqueueAppearanceUpdate(() => applyAppearanceConfig(data)),

});
