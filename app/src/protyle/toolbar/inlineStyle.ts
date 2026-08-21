export type TInlineStyleType = "color" | "backgroundColor" | "style1";
export type TInlineStyleMode = "light" | "dark";
export type TInlineStyleProperty = "color" | "backgroundColor";

export interface IInlineStyleColors {
    color?: string;
    backgroundColor?: string;
}

export interface IInlineStyle {
    id: string;
    name: string;
    light: IInlineStyleColors;
    dark: IInlineStyleColors;
}

export interface IInlineStyles {
    version: 1;
    styles: IInlineStyle[];
}

export interface IInlineStyleApplication {
    type: TInlineStyleType;
    color: string;
}

export const INLINE_STYLE_EMPTY: IInlineStyles = {
    version: 1,
    styles: [],
};

export const MAX_INLINE_STYLES = 64;
export const MAX_INLINE_STYLE_NAME_LENGTH = 64;

export const INLINE_FONT_COLORS = [
    "",
    ...Array.from({length: 13}, (_, index) => `var(--b3-font-color${index + 1})`),
];

export const INLINE_BACKGROUND_COLORS = [
    "",
    ...Array.from({length: 13}, (_, index) => `var(--b3-font-background${index + 1})`),
];

const INLINE_STYLE_ID_PATTERN = /^[0-9]{14}-[a-z0-9]{7}$/;
const INLINE_STYLE_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const INLINE_STYLE_VARIABLE_PATTERN = /var\(--b3-inline-style-([A-Za-z0-9_-]+?)-(?:background-color|color)(?:\s*,|\))/;
const INLINE_STYLE_SEPARATOR = "\u200b";

let inlineStylesCache: IInlineStyles | undefined;
let inlineStylesLoadPromise: Promise<IInlineStyles> | undefined;
let inlineStylesLoadPromiseGeneration = 0;
let inlineStylesRequestGeneration = 0;

const normalizeColor = (value: unknown) => {
    if (typeof value !== "string" || !INLINE_STYLE_COLOR_PATTERN.test(value)) {
        return;
    }
    return value.toLowerCase();
};

const normalizeStyle = (value: unknown): IInlineStyle | undefined => {
    if (!value || typeof value !== "object") {
        return;
    }
    const style = value as Partial<IInlineStyle>;
    if (typeof style.id !== "string" || !INLINE_STYLE_ID_PATTERN.test(style.id) ||
        typeof style.name !== "string" || !style.name.trim()) {
        return;
    }
    const lightColor = normalizeColor(style.light?.color);
    const darkColor = normalizeColor(style.dark?.color);
    const lightBackground = normalizeColor(style.light?.backgroundColor);
    const darkBackground = normalizeColor(style.dark?.backgroundColor);
    const colors: { light: IInlineStyleColors, dark: IInlineStyleColors } = {
        light: {},
        dark: {},
    };
    if (lightColor && darkColor) {
        colors.light.color = lightColor;
        colors.dark.color = darkColor;
    }
    if (lightBackground && darkBackground) {
        colors.light.backgroundColor = lightBackground;
        colors.dark.backgroundColor = darkBackground;
    }
    if (!colors.light.color && !colors.light.backgroundColor) {
        return;
    }
    return {
        id: style.id,
        name: [...style.name.trim()].slice(0, MAX_INLINE_STYLE_NAME_LENGTH).join(""),
        ...colors,
    };
};

export const normalizeInlineStyles = (value: unknown): IInlineStyles => {
    const styles: IInlineStyle[] = [];
    const ids = new Set<string>();
    if (value && typeof value === "object" && Array.isArray((value as Partial<IInlineStyles>).styles)) {
        (value as Partial<IInlineStyles>).styles.forEach(item => {
            if (styles.length >= MAX_INLINE_STYLES) {
                return;
            }
            const style = normalizeStyle(item);
            if (style && !ids.has(style.id)) {
                ids.add(style.id);
                styles.push(style);
            }
        });
    }
    return {
        version: 1,
        styles,
    };
};

export const setInlineStylesCache = (data: unknown) => {
    inlineStylesCache = normalizeInlineStyles(data);
    return inlineStylesCache;
};

export const getInlineStylesCache = () => inlineStylesCache || INLINE_STYLE_EMPTY;

export const loadInlineStyles = (force = false): Promise<IInlineStyles> => {
    if (!force && inlineStylesCache) {
        return Promise.resolve(inlineStylesCache);
    }
    if (!force && inlineStylesLoadPromise) {
        return inlineStylesLoadPromise;
    }
    const generation = ++inlineStylesRequestGeneration;
    inlineStylesLoadPromiseGeneration = generation;
    const request = (async () => {
        try {
            const {fetchSyncPost} = await import("../../util/fetch");
            const response = await fetchSyncPost("/api/storage/getInlineStyles");
            if (generation !== inlineStylesRequestGeneration) {
                return getInlineStylesCache();
            }
            if (response?.code !== 0) {
                return setInlineStylesCache(INLINE_STYLE_EMPTY);
            }
            return setInlineStylesCache(response.data);
        } catch (error) {
            if (generation !== inlineStylesRequestGeneration) {
                return getInlineStylesCache();
            }
            if (force && inlineStylesCache) {
                throw error;
            }
            return setInlineStylesCache(INLINE_STYLE_EMPTY);
        } finally {
            if (inlineStylesLoadPromiseGeneration === generation) {
                inlineStylesLoadPromise = undefined;
                inlineStylesLoadPromiseGeneration = 0;
            }
        }
    })();
    inlineStylesLoadPromise = request;
    return request;
};

export const saveInlineStyles = async (data: IInlineStyles) => {
    const normalized = normalizeInlineStyles(data);
    const [{Constants}, {fetchSyncPost}] = await Promise.all([
        import("../../constants"),
        import("../../util/fetch"),
    ]);
    const response = await fetchSyncPost("/api/storage/setInlineStyles", {
        ...normalized,
        app: Constants.SIYUAN_APPID,
    });
    if (response?.code !== 0) {
        return response;
    }
    inlineStylesRequestGeneration++;
    setInlineStylesCache(response.data || normalized);
    return response;
};

export const getInlineStyleType = (style: IInlineStyle): TInlineStyleType | undefined => {
    const hasColor = !!style.light.color && !!style.dark.color;
    const hasBackground = !!style.light.backgroundColor && !!style.dark.backgroundColor;
    if (hasColor && hasBackground) {
        return "style1";
    }
    if (hasColor) {
        return "color";
    }
    if (hasBackground) {
        return "backgroundColor";
    }
};

export const getCurrentInlineStyleMode = (): TInlineStyleMode =>
    document.documentElement.getAttribute("data-theme-mode") === "dark" ? "dark" : "light";

export const getInlineStyleVariableName = (id: string, property: TInlineStyleProperty) =>
    `--b3-inline-style-${id}-${property === "color" ? "color" : "background-color"}`;

export const getInlineStylePropertyValue = (style: IInlineStyle, property: TInlineStyleProperty,
                                            mode = getCurrentInlineStyleMode()) => {
    const fallback = style[mode][property];
    if (!fallback) {
        return "";
    }
    return `var(${getInlineStyleVariableName(style.id, property)}, ${fallback})`;
};

export const encodeStyle1 = (backgroundColor = "", color = "") =>
    backgroundColor + INLINE_STYLE_SEPARATOR + color;

export const decodeStyle1 = (value = "") => {
    const colors = value.split(INLINE_STYLE_SEPARATOR);
    return {
        backgroundColor: colors[0] || "",
        color: colors[1] || "",
    };
};

export const getInlineStyleApplication = (style: IInlineStyle,
                                          mode = getCurrentInlineStyleMode()): IInlineStyleApplication | undefined => {
    const type = getInlineStyleType(style);
    if (!type) {
        return;
    }
    const color = getInlineStylePropertyValue(style, "color", mode);
    const backgroundColor = getInlineStylePropertyValue(style, "backgroundColor", mode);
    return {
        type,
        color: type === "style1" ? encodeStyle1(backgroundColor, color) :
            (type === "color" ? color : backgroundColor),
    };
};

export const getInlineStylePreview = (style: IInlineStyle, mode = getCurrentInlineStyleMode(), variables = true) => ({
    color: style[mode].color ? (variables ? getInlineStylePropertyValue(style, "color", mode) : style[mode].color) : "",
    backgroundColor: style[mode].backgroundColor ?
        (variables ? getInlineStylePropertyValue(style, "backgroundColor", mode) : style[mode].backgroundColor) : "",
});

export const getInlineStyleIDFromValue = (value?: string) =>
    value?.match(INLINE_STYLE_VARIABLE_PATTERN)?.[1];

export const getInlineStyleByID = (id?: string, data = getInlineStylesCache()) =>
    id ? data.styles.find(item => item.id === id) : undefined;

export const getInlineStyleByValue = (value?: string, data = getInlineStylesCache()) =>
    getInlineStyleByID(getInlineStyleIDFromValue(value), data);

export const getRecentInlineStyleKey = (value: string) => {
    const id = getInlineStyleIDFromValue(value);
    if (!id) {
        return value;
    }
    return value.split(INLINE_STYLE_SEPARATOR)[0] + INLINE_STYLE_SEPARATOR + id;
};

export const getInlineStylesCSS = (data = getInlineStylesCache()) => {
    const normalized = normalizeInlineStyles(data);
    return (["light", "dark"] as TInlineStyleMode[]).map(mode => {
        const declarations: string[] = [];
        normalized.styles.forEach(style => {
            if (style[mode].color) {
                declarations.push(`  ${getInlineStyleVariableName(style.id, "color")}: ${style[mode].color};`);
            }
            if (style[mode].backgroundColor) {
                declarations.push(`  ${getInlineStyleVariableName(style.id, "backgroundColor")}: ${style[mode].backgroundColor};`);
            }
        });
        if (declarations.length === 0) {
            return "";
        }
        return `:root[data-theme-mode="${mode}"] {\n${declarations.join("\n")}\n}`;
    }).filter(Boolean).join("\n");
};
