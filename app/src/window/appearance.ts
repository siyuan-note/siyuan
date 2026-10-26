import {getThemeColor, getThemeMode} from "../util/assets";
import {isCompactModeEnabled} from "../config/tabs/compactMode";

// 新窗口在首帧就要按当前界面密度预留窗口按钮区，否则按钮会在加载完成后跳变。
export const getWindowAppearance = () => {
    const themeMode = document.documentElement.getAttribute("data-theme-mode") || getThemeMode();
    return {
        themeMode,
        backgroundColor: getThemeColor("--b3-theme-background", themeMode === "dark" ? "#1e1e1e" : "#ffffff"),
        foregroundColor: getThemeColor("--b3-theme-on-background", themeMode === "dark" ? "#d4d4d4" : "#222222"),
        compactMode: isCompactModeEnabled(),
    };
};
