import {getThemeColor, getThemeMode} from "../util/assets";

export const getWindowAppearance = () => {
    const themeMode = document.documentElement.getAttribute("data-theme-mode") || getThemeMode();
    return {
        themeMode,
        backgroundColor: getThemeColor("--b3-theme-background", themeMode === "dark" ? "#1e1e1e" : "#ffffff"),
        foregroundColor: getThemeColor("--b3-theme-on-background", themeMode === "dark" ? "#d4d4d4" : "#222222"),
    };
};
