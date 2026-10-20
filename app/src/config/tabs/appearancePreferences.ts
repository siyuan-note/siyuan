import {appearanceConfigApi} from "./appearanceRuntime";
import {applyCompactMode} from "./compactMode";
import {syncMenuMouseScroll} from "./menuMouseScroll";
/// #if MOBILE
import {showMobileBars} from "../../mobile/util/mobileBars";
import {updateSidebarButtons} from "../../mobile/util/sidebarButtons";
import {syncSidebarSetting} from "../../mobile/util/sidebarSetting";
import {syncMobileBarsSetting} from "../../mobile/util/mobileBarsSetting";
/// #endif

export const patchAppearancePreference = (path: string, value: unknown) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) return Promise.resolve();
    return appearanceConfigApi.patch(path, value);
};

// 配置确认后原位刷新已打开的面板和控件，保持当前交互与滚动位置。
export const syncAppearancePreferences = () => {
    const appearance = window.siyuan.config.appearance;
    applyCompactMode();
    syncMenuMouseScroll();
    document.querySelectorAll<HTMLElement>('[data-type="keepCurrentExpand"]').forEach(icon => {
        icon.classList.toggle(icon.classList.contains("toolbar__icon") ? "toolbar__icon--active" : "block__icon--active",
            appearance.outlineKeepCurrentExpand);
    });
    const theme = appearance.mode === 0 ? appearance.pdfTheme.light : appearance.pdfTheme.dark;
    document.querySelectorAll<HTMLElement>(".pdf__outer").forEach(outer => {
        outer.classList.toggle("pdf__outer--dark", theme === "dark");
        outer.querySelector("#pdfLight")?.classList.toggle("toggled", theme === "light");
        outer.querySelector("#pdfDark")?.classList.toggle("toggled", theme === "dark");
    });
    /// #if MOBILE
    syncSidebarSetting();
    syncMobileBarsSetting();
    updateSidebarButtons();
    showMobileBars();
    /// #endif
};
