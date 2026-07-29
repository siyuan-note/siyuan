import {fetchSyncPost} from "./fetch";

export const CUSTOM_FONT_FAMILY_PREFIX = "SiYuanCustomFont-";

export interface ICustomFont {
    id: string;
    family: string;
    weight: number;
    displayName: string;
    url: string;
}

let customFontsPromise: Promise<ICustomFont[]> | undefined;
const registeredFonts = new Map<string, ICustomFont>();

export const isNativeMobileContainer = () => {
    return ["android", "ios", "harmony"].includes(window.siyuan.config.system.container);
};

export const loadCustomFonts = () => {
    if (!customFontsPromise) {
        customFontsPromise = fetchSyncPost("/api/system/getCustomFonts").then((response) => {
            return Array.isArray(response.data) ? response.data as ICustomFont[] : [];
        }).catch((error) => {
            customFontsPromise = undefined;
            throw error;
        });
    }
    return customFontsPromise;
};

export const invalidateCustomFonts = () => {
    customFontsPromise = undefined;
};

export const registerCustomFont = (font: ICustomFont) => {
    if (window.siyuan.config.system.safeMode || !isValidCustomFont(font)) {
        return;
    }
    registeredFonts.set(font.id, {
        ...font,
        family: CUSTOM_FONT_FAMILY_PREFIX + font.id,
        url: `/custom-fonts/${font.id}`,
        weight: Math.max(1, Math.min(1000, font.weight || 400)),
    });
    renderCustomFontStyles();
};

export const unregisterCustomFont = (id: string) => {
    if (registeredFonts.delete(id)) {
        renderCustomFontStyles();
    }
};

export const ensureSelectedCustomFont = async (family: string, weight: number) => {
    if (window.siyuan.config.system.safeMode || !family.startsWith(CUSTOM_FONT_FAMILY_PREFIX)) {
        return;
    }

    const id = family.slice(CUSTOM_FONT_FAMILY_PREFIX.length);
    if (!isValidCustomFontID(id)) {
        return;
    }
    try {
        const fonts = await loadCustomFonts();
        const font = fonts.find((item) => item.id === id && item.family === family);
        if (!font) {
            return;
        }
        registerCustomFont(font);
        await document.fonts.load(`${weight || font.weight || 400} 16px "${family}"`);
    } catch (error) {
        console.warn("load custom font failed", error);
    }
};

const renderCustomFontStyles = () => {
    let styleElement = document.getElementById("customFontStyle") as HTMLStyleElement;
    if (registeredFonts.size === 0) {
        styleElement?.remove();
        return;
    }
    if (!styleElement) {
        styleElement = document.createElement("style");
        styleElement.id = "customFontStyle";
        document.head.append(styleElement);
    }
    styleElement.textContent = Array.from(registeredFonts.values()).map((font) => `@font-face {
  font-family: "${font.family}";
  src: url("${font.url}");
  font-style: normal;
  font-weight: ${font.weight};
  font-display: swap;
}`).join("\n");
};

const isValidCustomFont = (font: ICustomFont) => {
    return font && isValidCustomFontID(font.id) && font.family === CUSTOM_FONT_FAMILY_PREFIX + font.id;
};

const isValidCustomFontID = (id: string) => /^[a-f0-9]{64}$/.test(id);
