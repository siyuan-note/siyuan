/// #if MOBILE
import {saveScroll} from "../../protyle/scroll/saveScroll";
/// #else
import {adjustDockPadding} from "../../layout/dock/util";
import {exportLayout} from "../../layout/util";
import {syncHideToolbarLayout, updateBarModeIcon} from "../../layout/topBar";
/// #endif
import {fetchPost} from "../../util/fetch";
import {loadAssets, refreshHeadingNumberMeasurements, setBodyHighlight, setInlineStyle, unloadThemeScript} from "../../util/assets";
import {getFrontend} from "../../util/functions";
import {shouldUnloadThemeScript} from "../../util/themeCompatibility";
import {remountOpenSettingTab} from "../setting/mount";
import {createConfigNamespaceApi} from "../util/namespaceApi";
import {syncBodyGradient} from "./bodyGradient";

/** 主题模式下拉框初值：合并 mode / modeOS */
export const appearanceThemeModeValue = (): number =>
    window.siyuan.config.appearance.modeOS ? 2 : window.siyuan.config.appearance.mode;

/** 主题模式选择：合并 mode / modeOS 后提交 */
export const saveThemeMode = (value: number) => {
    const OSThemeMode = window.matchMedia("(prefers-color-scheme: dark)").matches ? 1 : 0;
    fetchPost("/api/setting/setAppearance", {
        ...window.siyuan.config.appearance,
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

const applyAppearanceConfig = async (data: Config.IAppearance) => {
    if (data.lang !== window.siyuan.config.appearance.lang) {
        /// #if MOBILE
        void reloadUI();
        /// #else
        void exportLayout({
            cb() {
                window.location.reload();
            },
            errorExit: false,
        });
        /// #endif
        return;
    }

    const prevAppearance = window.siyuan.config.appearance;
    // 仅更新背景渐变时原位同步控件，避免整页重建期间的布局变化引起滚动抖动。
    // 启动初始化传入当前配置本身，需要完整加载外观资源；重复推送仍使用原位同步。
    const appearanceKeys = Object.keys({...prevAppearance, ...data}) as Array<keyof Config.IAppearance>;
    if (prevAppearance !== data &&
        appearanceKeys.every(key => key === "bodyGradient" ||
            JSON.stringify(prevAppearance[key]) === JSON.stringify(data[key]))) {
        window.siyuan.config.appearance = data;
        setBodyHighlight(data.bodyGradient);
        syncBodyGradient();
        return;
    }
    if (shouldUnloadThemeScript(prevAppearance, data, getFrontend()) && !await unloadThemeScript()) {
        /// #if MOBILE
        void reloadUI();
        /// #else
        void exportLayout({
            errorExit: false,
            cb() {
                window.location.reload();
            },
        });
        /// #endif
        return;
    }

    window.siyuan.config.appearance = data;

    document.getElementById("status")?.classList.toggle("fn__none", data.hideStatusBar);
    /// #if !MOBILE
    if (data.hideStatusBar !== prevAppearance.hideStatusBar) {
        adjustDockPadding();
    }
    if (data.hideToolbar !== prevAppearance.hideToolbar) {
        syncHideToolbarLayout();
    }
    updateBarModeIcon();
    /// #endif

    loadAssets(data);
    if (JSON.stringify(data.globalFontFamilies) !== JSON.stringify(prevAppearance.globalFontFamilies)) {
        await setInlineStyle();
        refreshHeadingNumberMeasurements();
    }
    /// #if !MOBILE
    void remountOpenSettingTab("appearance");
    /// #endif
};

/** 外观 Tab 命名空间：设置面板注册项 save */
export const appearanceConfigApi = createConfigNamespaceApi<Config.IAppearance>({
    namespace: "appearance",
    getConfig: () => window.siyuan.config.appearance,
    setConfig: (data) => {
        void applyAppearanceConfig(data);
    },
    apiPath: "/api/setting/setAppearance",
    applyFromResponse: false,
});
