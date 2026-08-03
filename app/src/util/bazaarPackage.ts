const reservedWindowsDeviceNames = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

export const getBazaarCompatibilityFieldVisibility = (packageType: string) => {
    const isPlugin = packageType === "plugins";
    const isTheme = packageType === "themes";
    return {
        frontends: isPlugin || isTheme,
        systems: isPlugin,
        disabledInPublish: isPlugin,
        modes: isTheme,
    };
};

export const getBazaarThemeModeLabels = (
    modes: string[] | null | undefined,
    lightLabel: string,
    darkLabel: string,
) => Array.from(new Set((modes || []).filter(Boolean).map((mode) => {
    if (mode === "light") {
        return lightLabel;
    }
    if (mode === "dark") {
        return darkLabel;
    }
    return mode;
})));

export const isValidBazaarPackageName = (name: string) => {
    if (!/^[\x20-\x7E]{1,255}$/.test(name) || /^[. ]/.test(name) || /[. ]$/.test(name)) {
        return false;
    }
    if (/[<>&'":/\\|?*]/.test(name)) {
        return false;
    }
    return !reservedWindowsDeviceNames.has(name.toUpperCase());
};
