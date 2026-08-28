export type TBrowserNavigator = Pick<Navigator, "maxTouchPoints" | "platform" | "userAgent">;

export const isIPadOSPlatform = (browserNavigator: TBrowserNavigator) => {
    return browserNavigator.userAgent.includes("iPad") ||
        (browserNavigator.platform === "MacIntel" && browserNavigator.maxTouchPoints > 1);
};

export const isIOSPlatform = (browserNavigator: TBrowserNavigator) => {
    return /iPhone|iPod/.test(browserNavigator.userAgent) || isIPadOSPlatform(browserNavigator);
};
