export const isThemeFrontendSupported = (
    frontends: string[] | null | undefined,
    frontend: string,
) => {
    if (!frontends?.length) {
        return !["mobile", "browser-mobile"].includes(frontend);
    }
    if (frontends.includes("all")) {
        return true;
    }
    return frontends.includes(frontend);
};

export const getCurrentAppearanceTheme = (appearance: Config.IAppearance) => {
    const themeName = appearance.mode === 1 ? appearance.themeDark : appearance.themeLight;
    const themes = appearance.mode === 1 ? appearance.darkThemes : appearance.lightThemes;
    return themes?.find((item) => item.name === themeName);
};

export const getCurrentThemeName = (appearance: Config.IAppearance) => {
    return appearance.mode === 1 ? appearance.themeDark : appearance.themeLight;
};

export const isCurrentThemeSupported = (appearance: Config.IAppearance, frontend: string) => {
    return isThemeFrontendSupported(getCurrentAppearanceTheme(appearance)?.frontends, frontend);
};

export const shouldUnloadThemeScript = (
    previous: Config.IAppearance,
    next: Config.IAppearance,
    frontend: string,
) => {
    const previousThemeScriptLoaded = previous.themeJS && isCurrentThemeSupported(previous, frontend);
    return previousThemeScriptLoaded && (previous.mode !== next.mode ||
        getCurrentThemeName(previous) !== getCurrentThemeName(next) ||
        previous.themeVer !== next.themeVer ||
        !next.themeJS ||
        !isCurrentThemeSupported(next, frontend));
};
