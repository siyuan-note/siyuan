const reservedWindowsDeviceNames = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

export const isValidBazaarPackageName = (name: string) => {
    if (!/^[\x20-\x7E]{1,255}$/.test(name) || /^[. ]/.test(name) || /[. ]$/.test(name)) {
        return false;
    }
    if (/[<>&'":/\\|?*]/.test(name)) {
        return false;
    }
    return !reservedWindowsDeviceNames.has(name.toUpperCase());
};
