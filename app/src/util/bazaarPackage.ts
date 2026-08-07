const reservedWindowsDeviceNames = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

export const getBazaarCompatibilityData = <T extends object>(
    source: "downloaded" | "updated" | "bazaar",
    installed: T | undefined,
    available: T | undefined,
    fallback: T,
) => source === "downloaded" ? installed ?? fallback : available ?? installed ?? fallback;

export const getBazaarCompatibilityFieldVisibility = (packageType: string) => {
    const isPlugin = packageType === "plugins";
    const isTheme = packageType === "themes";
    return {
        frontends: isPlugin || isTheme,
        systems: isPlugin,
        kernelSystems: isPlugin,
        disabledInPublish: isPlugin,
        modes: isTheme,
    };
};

const getBazaarSystemLabels = (systems: string[], allLabel: string) => {
    if (!systems.length || systems.includes("all")) {
        return [allLabel];
    }
    const labels: Record<string, string> = {
        windows: "Windows",
        linux: "Linux",
        darwin: "macOS",
        android: "Android",
        ios: "iOS",
        harmony: "HarmonyOS",
        docker: "Docker",
    };
    return Array.from(new Set(systems.map((system) => labels[system] || system)));
};

export const getBazaarBackendSystemLabels = (backends: string[] | null | undefined, allLabel: string) =>
    getBazaarSystemLabels(backends || [], allLabel);

export const getBazaarKernelSystemLabels = (kernels: string[] | null | undefined, allLabel: string) =>
    kernels?.length ? getBazaarSystemLabels(kernels, allLabel) : [];

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

const normalizeBazaarFundingURL = (value: string | undefined, base: string) => {
    if (!value) {
        return "";
    }
    if (value.startsWith("https://") || value.startsWith("http://")) {
        return value;
    }
    return `${base}${value}`;
};

export const getBazaarFundingItems = (funding: IBazaarFunding | null | undefined) => {
    if (!funding) {
        return [];
    }
    return [
        normalizeBazaarFundingURL(funding.openCollective, "https://opencollective.com/"),
        normalizeBazaarFundingURL(funding.patreon, "https://www.patreon.com/"),
        normalizeBazaarFundingURL(funding.github, "https://github.com/sponsors/"),
        ...(funding.custom || []),
    ].filter(Boolean);
};

export const isValidBazaarPackageName = (name: string) => {
    if (!/^[\x20-\x7E]{1,255}$/.test(name) || /^[. ]/.test(name) || /[. ]$/.test(name)) {
        return false;
    }
    if (/[<>&'":/\\|?*]/.test(name)) {
        return false;
    }
    return !reservedWindowsDeviceNames.has(name.toUpperCase());
};
