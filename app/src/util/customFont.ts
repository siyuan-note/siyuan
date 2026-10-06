import {fetchSyncPost} from "./fetch";

export const CUSTOM_FONT_FAMILY_PREFIX = "SiYuanCustomFont-";

export interface ICustomFont {
    id: string;
    family: string;
    weight: number;
    displayName: string;
    aliases?: string[];
    spacing?: string;
    url: string;
}

let customFontsPromise: Promise<ICustomFont[]> | undefined;
const registeredFonts = new Map<string, ICustomFont>();
const fontLoadPromises = new Map<string, Promise<FontFace[]>>();

export const supportsCustomFonts = () => {
    return ["docker", "android", "ios", "harmony"].includes(window.siyuan.config.system.container);
};

export const loadCustomFonts = () => {
    if (!customFontsPromise) {
        const request = fetchSyncPost("/api/system/getCustomFonts").then((response) => {
            if (response.code !== 0 || !Array.isArray(response.data)) {
                throw new Error(response.msg || "load custom fonts failed");
            }
            return response.data as ICustomFont[];
        });
        customFontsPromise = request;
        const clearRequest = () => {
            // 仅合并在途请求，后续读取可以获取其他窗口导入或删除的字体。
            if (customFontsPromise === request) {
                customFontsPromise = undefined;
            }
        };
        void request.then(clearRequest, clearRequest);
    }
    return customFontsPromise;
};

export const invalidateCustomFonts = () => {
    customFontsPromise = undefined;
};

export const registerCustomFont = (font: ICustomFont) => {
    registerCustomFonts([font]);
};

export const registerCustomFonts = (fonts: ICustomFont[]) => {
    if (window.siyuan.config.system.safeMode) {
        return;
    }
    fonts.forEach((font) => {
        if (!isValidCustomFont(font)) {
            return;
        }
        const normalizedFont = {
            ...font,
            family: CUSTOM_FONT_FAMILY_PREFIX + font.id,
            url: `/custom-fonts/${font.id}`,
            weight: Math.max(1, Math.min(1000, font.weight || 400)),
        };
        const registeredFont = registeredFonts.get(font.id);
        if (registeredFont?.family === normalizedFont.family &&
            registeredFont.url === normalizedFont.url &&
            registeredFont.weight === normalizedFont.weight) {
            return;
        }
        registeredFonts.set(font.id, normalizedFont);
        fontLoadPromises.delete(font.id);
        setCustomFontStyle(normalizedFont);
    });
};

export const unregisterCustomFont = (id: string) => {
    fontLoadPromises.delete(id);
    if (registeredFonts.delete(id)) {
        document.getElementById(`customFontStyle-${id}`)?.remove();
    }
};

export const syncCustomFonts = (fonts: ICustomFont[]) => {
    if (window.siyuan.config.system.safeMode) {
        return;
    }
    const ids = new Set(fonts.filter(isValidCustomFont).map(font => font.id));
    registeredFonts.forEach((font, id) => {
        if (!ids.has(id)) {
            unregisterCustomFont(id);
        }
    });
    registerCustomFonts(fonts);
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
        let loadPromise = fontLoadPromises.get(id);
        if (!loadPromise) {
            loadPromise = document.fonts.load(`${weight || font.weight || 400} 16px "${family}"`).catch((error) => {
                fontLoadPromises.delete(id);
                throw error;
            });
            fontLoadPromises.set(id, loadPromise);
        }
        await loadPromise;
    } catch (error) {
        console.warn("load custom font failed", error);
    }
};

export const ensureSelectedCustomFonts = async (fonts: Array<{ family: string; weight: number }>) => {
    const registration = !window.siyuan.config.system.safeMode && supportsCustomFonts() ?
        loadCustomFonts().then(customFonts => {
            // 注册所有导入字体的 CSS，正文中使用的字体由浏览器按需加载。
            syncCustomFonts(customFonts);
        }).catch(error => {
            console.warn("register custom fonts failed", error);
        }) : Promise.resolve();
    await Promise.all([registration, ...fonts.map((font) => ensureSelectedCustomFont(font.family, font.weight))]);
};

export const getCustomFontStyle = async () => {
    if (window.siyuan.config.system.safeMode) {
        return "";
    }
    // 导出预览注册可用字体，字体文件仍由浏览器根据正文样式按需加载。
    return (await loadCustomFonts()).filter(isValidCustomFont)
        .map(font => getCustomFontCSS(font, `/custom-fonts/${font.id}`)).join("\n");
};

export const getExportCustomFontStyle = async (fonts: Array<{family: string}>, html = "") => {
    if (window.siyuan.config.system.safeMode) {
        return "";
    }
    const families = new Set(fonts.map((font) => font.family).filter((family) =>
        family.startsWith(CUSTOM_FONT_FAMILY_PREFIX)));
    if (html) {
        const template = document.createElement("template");
        template.innerHTML = html;
        template.content.querySelectorAll<HTMLElement>("[style]").forEach(element => {
            element.style.fontFamily.match(/SiYuanCustomFont-[a-f0-9]{64}/g)?.forEach(family => families.add(family));
        });
    }
    if (families.size === 0) {
        return "";
    }
    const customFonts = (await loadCustomFonts()).filter((font) => isValidCustomFont(font) && families.has(font.family));
    const styles = await Promise.all(customFonts.map(async (font) => {
        const response = await fetch(`/custom-fonts/${font.id}`);
        if (!response.ok) {
            throw new Error(`export custom font failed: ${response.status}`);
        }
        const blob = await response.blob();
        const dataURL = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
        return getCustomFontCSS(font, dataURL);
    }));
    return styles.join("\n");
};

const getCustomFontCSS = (font: ICustomFont, source: string) =>
    `@font-face { font-family: "${font.family}"; src: url("${source}"); font-style: normal; font-weight: ${Math.max(1, Math.min(1000, font.weight || 400))}; font-display: swap; }`;

const setCustomFontStyle = (font: ICustomFont) => {
    let styleElement = document.getElementById(`customFontStyle-${font.id}`) as HTMLStyleElement;
    if (!styleElement) {
        styleElement = document.createElement("style");
        styleElement.id = `customFontStyle-${font.id}`;
        document.head.append(styleElement);
    }
    styleElement.textContent = `@font-face {
  font-family: "${font.family}";
  src: url("${font.url}");
  font-style: normal;
  font-weight: ${font.weight};
  font-display: swap;
}`;
};

const isValidCustomFont = (font: ICustomFont) => {
    return font && isValidCustomFontID(font.id) && font.family === CUSTOM_FONT_FAMILY_PREFIX + font.id;
};

const isValidCustomFontID = (id: string) => /^[a-f0-9]{64}$/.test(id);
