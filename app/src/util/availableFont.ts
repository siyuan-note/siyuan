import {ICustomFont, loadCustomFonts, syncCustomFonts, supportsCustomFonts} from "./customFont";
import {loadSystemFonts} from "./systemFont";
import type {IFontItem} from "./systemFontCore";

export const loadAvailableFonts = async () => {
    const customFontSupported = supportsCustomFonts();
    const [systemResult, customResult] = await Promise.allSettled([
        loadSystemFonts(),
        customFontSupported ? loadCustomFonts() : Promise.resolve([] as ICustomFont[]),
    ]);
    const systemFonts: IFontItem[] = systemResult.status === "fulfilled" ? systemResult.value : [];
    const customFonts = customResult.status === "fulfilled" ? customResult.value : [];
    if (systemResult.status === "rejected") {
        console.warn("load system fonts failed", systemResult.reason);
    }
    if (customResult.status === "rejected") {
        console.warn("load custom fonts failed", customResult.reason);
    } else if (customFontSupported) {
        syncCustomFonts(customFonts);
    }
    return {customFontSupported, customFonts, fontItems: [...customFonts, ...systemFonts]};
};
