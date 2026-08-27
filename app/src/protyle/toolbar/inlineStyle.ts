export type TInlineStyleType = "color" | "backgroundColor" | "style1";
export type TBuiltinColorType = TInlineStyleType | "av";
export type TInlineStyleMode = "light" | "dark";
export type TInlineStyleProperty = "color" | "backgroundColor";

export interface IInlineStyleColors {
    color?: string;
    backgroundColor?: string;
}

export interface IInlineStyle {
    id: string;
    name: string;
    hidden?: boolean;
    light: IInlineStyleColors;
    dark: IInlineStyleColors;
}

export const BUILTIN_INLINE_COLOR_COUNT = 13;
export const AV_BUILTIN_COLOR_COUNT = 14;
export const AV_CUSTOM_COLOR_MIN = 15;
export const AV_CUSTOM_COLOR_MAX = 78;
export const AV_CUSTOM_COLOR_LIMIT = 64;
export const BUILTIN_INLINE_STYLE_IDS = ["error", "warning", "info", "success"] as const;

export type TBuiltinInlineStyleID = typeof BUILTIN_INLINE_STYLE_IDS[number];

export interface IBuiltinInlineColor {
    index: number;
    light: IInlineStyleColors;
    dark: IInlineStyleColors;
}

export interface IBuiltinInlineStyle {
    id: TBuiltinInlineStyleID;
    light: IInlineStyleColors;
    dark: IInlineStyleColors;
}

export interface IBuiltinInlineStyleHidden {
    color: number[];
    backgroundColor: number[];
    style1: TBuiltinInlineStyleID[];
    av: number[];
}

export interface IInlineStyleBuiltin {
    colors: IBuiltinInlineColor[];
    styles: IBuiltinInlineStyle[];
    hidden: IBuiltinInlineStyleHidden;
}

export interface IInlineStyleOrder {
    color: string[];
    backgroundColor: string[];
    style1: string[];
}

export interface IInlineStyleAV {
    colors: IAVCustomColor[];
    order: string[];
}

export interface IWorkspaceAVBuiltinColorUpdate extends IBuiltinInlineColor {
    customized: boolean;
    hidden: boolean;
}

export interface IInlineStyles {
    version: 2;
    builtin: IInlineStyleBuiltin;
    styles: IInlineStyle[];
    order: IInlineStyleOrder;
    av: IInlineStyleAV;
}

export interface IInlineStyleApplication {
    type: TInlineStyleType;
    color: string;
}

export const DEFAULT_BUILTIN_COLOR_ORDER = Array.from({length: BUILTIN_INLINE_COLOR_COUNT}, (_, index) =>
    (index + 1).toString());

export const DEFAULT_INLINE_STYLE_ORDER: IInlineStyleOrder = {
    color: [...DEFAULT_BUILTIN_COLOR_ORDER],
    backgroundColor: [...DEFAULT_BUILTIN_COLOR_ORDER],
    style1: [...BUILTIN_INLINE_STYLE_IDS],
};

export const DEFAULT_AV_COLOR_ORDER = Array.from({length: AV_BUILTIN_COLOR_COUNT}, (_, index) =>
    (index + 1).toString());

export const INLINE_STYLE_EMPTY: IInlineStyles = {
    version: 2,
    builtin: {
        colors: [],
        styles: [],
        hidden: {
            color: [],
            backgroundColor: [],
            style1: [],
            av: [],
        },
    },
    styles: [],
    order: {
        color: [...DEFAULT_INLINE_STYLE_ORDER.color],
        backgroundColor: [...DEFAULT_INLINE_STYLE_ORDER.backgroundColor],
        style1: [...DEFAULT_INLINE_STYLE_ORDER.style1],
    },
    av: {
        colors: [],
        order: [...DEFAULT_AV_COLOR_ORDER],
    },
};

export const MAX_INLINE_STYLES = 64;
export const MAX_INLINE_STYLE_NAME_LENGTH = 64;

export const INLINE_FONT_COLORS = [
    "",
    ...Array.from({length: BUILTIN_INLINE_COLOR_COUNT}, (_, index) => `var(--b3-font-color${index + 1})`),
];

export const INLINE_BACKGROUND_COLORS = [
    "",
    ...Array.from({length: BUILTIN_INLINE_COLOR_COUNT}, (_, index) => `var(--b3-font-background${index + 1})`),
];

const INLINE_STYLE_ID_PATTERN = /^[0-9]{14}-[a-z0-9]{7}$/;
const INLINE_STYLE_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const INLINE_STYLE_VARIABLE_PATTERN = /var\(--b3-inline-style-([A-Za-z0-9_-]+?)-(?:background-color|color)(?:\s*,|\))/;
const INLINE_STYLE_SEPARATOR = "\u200b";
const BUILTIN_FONT_COLOR_VARIABLE_PATTERN = /^var\(--b3-font-color(\d+)\)$/;
const BUILTIN_BACKGROUND_COLOR_VARIABLE_PATTERN = /^var\(--b3-font-background(\d+)\)$/;

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
        ...(style.hidden === true ? {hidden: true} : {}),
        ...colors,
    };
};

const normalizePairedColors = (value: unknown) => {
    if (!value || typeof value !== "object") {
        return;
    }
    const colors = value as { light?: IInlineStyleColors, dark?: IInlineStyleColors };
    const lightColor = normalizeColor(colors.light?.color);
    const darkColor = normalizeColor(colors.dark?.color);
    const lightBackground = normalizeColor(colors.light?.backgroundColor);
    const darkBackground = normalizeColor(colors.dark?.backgroundColor);
    const result: { light: IInlineStyleColors, dark: IInlineStyleColors } = {
        light: {},
        dark: {},
    };
    if (lightColor && darkColor) {
        result.light.color = lightColor;
        result.dark.color = darkColor;
    }
    if (lightBackground && darkBackground) {
        result.light.backgroundColor = lightBackground;
        result.dark.backgroundColor = darkBackground;
    }
    if (!result.light.color && !result.light.backgroundColor) {
        return;
    }
    return result;
};

const normalizeBuiltinColors = (value: unknown) => {
    const colors: IBuiltinInlineColor[] = [];
    const indexes = new Set<number>();
    if (!Array.isArray(value)) {
        return colors;
    }
    value.forEach(item => {
        if (!item || typeof item !== "object") {
            return;
        }
        const index = Number((item as Partial<IBuiltinInlineColor>).index);
        const pairedColors = normalizePairedColors(item);
        if (!Number.isInteger(index) || index < 1 || index > AV_BUILTIN_COLOR_COUNT ||
            indexes.has(index) || !pairedColors) {
            return;
        }
        indexes.add(index);
        colors.push({index, ...pairedColors});
    });
    return colors.sort((a, b) => a.index - b.index);
};

const normalizeBuiltinStyles = (value: unknown) => {
    const styles: IBuiltinInlineStyle[] = [];
    const ids = new Set<TBuiltinInlineStyleID>();
    if (!Array.isArray(value)) {
        return styles;
    }
    value.forEach(item => {
        if (!item || typeof item !== "object") {
            return;
        }
        const id = (item as Partial<IBuiltinInlineStyle>).id;
        const pairedColors = normalizePairedColors(item);
        if (!BUILTIN_INLINE_STYLE_IDS.includes(id as TBuiltinInlineStyleID) ||
            ids.has(id as TBuiltinInlineStyleID) || !pairedColors) {
            return;
        }
        ids.add(id as TBuiltinInlineStyleID);
        styles.push({id: id as TBuiltinInlineStyleID, ...pairedColors});
    });
    return styles.sort((a, b) => BUILTIN_INLINE_STYLE_IDS.indexOf(a.id) - BUILTIN_INLINE_STYLE_IDS.indexOf(b.id));
};

const normalizeHiddenIndexes = (value: unknown, max = BUILTIN_INLINE_COLOR_COUNT) => {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value.filter(item => Number.isInteger(item) && item >= 1 &&
        item <= max) as number[])).sort((a, b) => a - b);
};

const normalizeHiddenStyleIDs = (value: unknown) => {
    if (!Array.isArray(value)) {
        return [];
    }
    const ids = new Set(value.filter(item => BUILTIN_INLINE_STYLE_IDS.includes(item as TBuiltinInlineStyleID)) as
        TBuiltinInlineStyleID[]);
    return BUILTIN_INLINE_STYLE_IDS.filter(id => ids.has(id));
};

const normalizeBuiltin = (value: unknown): IInlineStyleBuiltin => {
    const builtin = value && typeof value === "object" ? value as Partial<IInlineStyleBuiltin> : {};
    const hidden = builtin.hidden && typeof builtin.hidden === "object" ?
        builtin.hidden as Partial<IBuiltinInlineStyleHidden> : {};
    return {
        colors: normalizeBuiltinColors(builtin.colors),
        styles: normalizeBuiltinStyles(builtin.styles),
        hidden: {
            color: normalizeHiddenIndexes(hidden.color),
            backgroundColor: normalizeHiddenIndexes(hidden.backgroundColor),
            style1: normalizeHiddenStyleIDs(hidden.style1),
            av: normalizeHiddenIndexes(hidden.av, AV_BUILTIN_COLOR_COUNT),
        },
    };
};

const normalizeStoredAVColor = (value: unknown): IAVCustomColor | undefined => {
    if (!value || typeof value !== "object") {
        return;
    }
    const color = value as Partial<IAVCustomColor>;
    const index = Number(color.index);
    const lightColor = normalizeColor(color.light?.color);
    const lightBackground = normalizeColor(color.light?.backgroundColor);
    const darkColor = normalizeColor(color.dark?.color);
    const darkBackground = normalizeColor(color.dark?.backgroundColor);
    if (!Number.isInteger(index) || index < AV_CUSTOM_COLOR_MIN || index > AV_CUSTOM_COLOR_MAX ||
        !lightColor || !lightBackground || !darkColor || !darkBackground) {
        return;
    }
    return {
        index,
        ...(color.hidden === true ? {hidden: true} : {}),
        light: {color: lightColor, backgroundColor: lightBackground},
        dark: {color: darkColor, backgroundColor: darkBackground},
    };
};

const normalizeStoredAVColors = (value: unknown) => {
    const colors: IAVCustomColor[] = [];
    const indexes = new Set<number>();
    if (!Array.isArray(value)) {
        return colors;
    }
    value.forEach(item => {
        if (colors.length >= AV_CUSTOM_COLOR_LIMIT) {
            return;
        }
        const color = normalizeStoredAVColor(item);
        if (!color || indexes.has(color.index)) {
            return;
        }
        indexes.add(color.index);
        colors.push(color);
    });
    return colors.sort((a, b) => a.index - b.index);
};

const defaultAVColorOrder = (colors: Pick<IAVCustomColor, "index">[]) => [
    ...DEFAULT_AV_COLOR_ORDER,
    ...colors.map(item => item.index.toString()),
];

const normalizeStoredAVOrder = (value: unknown, colors: Pick<IAVCustomColor, "index">[]) => {
    const allowed = new Set(defaultAVColorOrder(colors));
    const result: string[] = [];
    const seen = new Set<string>();
    if (Array.isArray(value)) {
        value.forEach(item => {
            if (typeof item !== "string" || !allowed.has(item) || seen.has(item)) {
                return;
            }
            seen.add(item);
            result.push(item);
        });
    }
    defaultAVColorOrder(colors).forEach(key => {
        if (!seen.has(key)) {
            result.push(key);
        }
    });
    return result;
};

const normalizeAVPalette = (value: unknown): IInlineStyleAV => {
    const av = value && typeof value === "object" ? value as Partial<IInlineStyleAV> : {};
    const colors = normalizeStoredAVColors(av.colors);
    return {
        colors,
        order: normalizeStoredAVOrder(av.order, colors),
    };
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

export const getDefaultBuiltinOrderKeys = (type: TInlineStyleType) =>
    type === "style1" ? [...BUILTIN_INLINE_STYLE_IDS] : [...DEFAULT_BUILTIN_COLOR_ORDER];

export const isBuiltinOrderKey = (type: TInlineStyleType, key: string) =>
    getDefaultBuiltinOrderKeys(type).includes(key);

const getCustomOrderKeys = (type: TInlineStyleType, styles: IInlineStyle[]) =>
    styles.filter(style => getInlineStyleType(style) === type).map(style => style.id);

const normalizeOrderKeys = (value: unknown, type: TInlineStyleType, styles: IInlineStyle[]) => {
    const builtinKeys = getDefaultBuiltinOrderKeys(type);
    const customKeys = getCustomOrderKeys(type, styles);
    const allowed = new Set([...builtinKeys, ...customKeys]);
    const result: string[] = [];
    const seen = new Set<string>();
    if (Array.isArray(value)) {
        value.forEach(item => {
            if (typeof item !== "string" || !allowed.has(item) || seen.has(item)) {
                return;
            }
            seen.add(item);
            result.push(item);
        });
    }
    [...builtinKeys, ...customKeys].forEach(key => {
        if (!seen.has(key)) {
            result.push(key);
        }
    });
    return result;
};

const normalizeOrder = (value: unknown, styles: IInlineStyle[]): IInlineStyleOrder => {
    const order = value && typeof value === "object" ? value as Partial<IInlineStyleOrder> : {};
    return {
        color: normalizeOrderKeys(order.color, "color", styles),
        backgroundColor: normalizeOrderKeys(order.backgroundColor, "backgroundColor", styles),
        style1: normalizeOrderKeys(order.style1, "style1", styles),
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
        version: 2,
        builtin: normalizeBuiltin(value && typeof value === "object" ?
            (value as Partial<IInlineStyles>).builtin : undefined),
        styles,
        order: normalizeOrder(value && typeof value === "object" ?
            (value as Partial<IInlineStyles>).order : undefined, styles),
        av: normalizeAVPalette(value && typeof value === "object" ?
            (value as Partial<IInlineStyles>).av : undefined),
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

export const saveWorkspaceAVPalette = async (data: IInlineStyleAV,
                                             builtinColors: IWorkspaceAVBuiltinColorUpdate[]) => {
    const [{Constants}, {fetchSyncPost}] = await Promise.all([
        import("../../constants"),
        import("../../util/fetch"),
    ]);
    const response = await fetchSyncPost("/api/storage/setWorkspaceAVPalette", {
        colors: data.colors,
        order: data.order,
        builtinColors,
        app: Constants.SIYUAN_APPID,
    });
    if (response?.code !== 0) {
        return response;
    }
    inlineStylesRequestGeneration++;
    if (response.data) {
        setInlineStylesCache(response.data);
    }
    return response;
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

export const getBuiltinInlineColor = (index: number, data = getInlineStylesCache()) =>
    data.builtin.colors.find(item => item.index === index);

export const getBuiltinInlineStyle = (id: TBuiltinInlineStyleID, data = getInlineStylesCache()) =>
    data.builtin.styles.find(item => item.id === id);

export const getBuiltinColorVariableName = (index: number, property: TInlineStyleProperty) =>
    `--b3-font-${property === "color" ? "color" : "background"}${index}`;

export const getBuiltinColorPropertyValue = (index: number, property: TInlineStyleProperty) =>
    `var(${getBuiltinColorVariableName(index, property)})`;

export const getBuiltinInlineStyleVariableName = (id: TBuiltinInlineStyleID, property: TInlineStyleProperty) =>
    `--b3-inline-builtin-${id}-${property === "color" ? "color" : "background-color"}`;

export const getBuiltinInlineStyleLegacyVariableName = (id: TBuiltinInlineStyleID,
                                                        property: TInlineStyleProperty) =>
    `--b3-card-${id}-${property === "color" ? "color" : "background"}`;

export const getBuiltinInlineStylePropertyValue = (id: TBuiltinInlineStyleID,
                                                   property: TInlineStyleProperty) =>
    `var(${getBuiltinInlineStyleVariableName(id, property)}, ` +
    `var(${getBuiltinInlineStyleLegacyVariableName(id, property)}))`;

export const getBuiltinInlineStylePreview = (id: TBuiltinInlineStyleID) => ({
    color: getBuiltinInlineStylePropertyValue(id, "color"),
    backgroundColor: getBuiltinInlineStylePropertyValue(id, "backgroundColor"),
});

export const getBuiltinInlineStyleApplication = (id: TBuiltinInlineStyleID): IInlineStyleApplication => ({
    type: "style1",
    color: encodeStyle1(getBuiltinInlineStylePropertyValue(id, "backgroundColor"),
        getBuiltinInlineStylePropertyValue(id, "color")),
});

export const isBuiltinInlineStyleVisible = (type: TBuiltinColorType, value: number | TBuiltinInlineStyleID,
                                           data = getInlineStylesCache()) => {
    if (type === "style1") {
        return !BUILTIN_INLINE_STYLE_IDS.includes(value as TBuiltinInlineStyleID) ||
            !data.builtin.hidden.style1.includes(value as TBuiltinInlineStyleID);
    }
    const index = Number(value);
    const max = type === "av" ? AV_BUILTIN_COLOR_COUNT : BUILTIN_INLINE_COLOR_COUNT;
    return !Number.isInteger(index) || index < 1 || index > max ||
        !data.builtin.hidden[type].includes(index);
};

export const getVisibleBuiltinColorIndexes = (type: Exclude<TBuiltinColorType, "style1">,
                                              data = getInlineStylesCache()) => {
    const count = type === "av" ? AV_BUILTIN_COLOR_COUNT : BUILTIN_INLINE_COLOR_COUNT;
    return Array.from({length: count}, (_, index) => index + 1)
        .filter(index => isBuiltinInlineStyleVisible(type, index, data));
};

export const getVisibleBuiltinInlineStyleIDs = (data = getInlineStylesCache()) =>
    BUILTIN_INLINE_STYLE_IDS.filter(id => isBuiltinInlineStyleVisible("style1", id, data));

export const getOrderedStyleKeys = (type: TInlineStyleType, data = getInlineStylesCache()) =>
    normalizeInlineStyles(data).order[type];

export const getVisibleOrderedStyleKeys = (type: TInlineStyleType, data = getInlineStylesCache()) => {
    const normalized = normalizeInlineStyles(data);
    return normalized.order[type].filter(key => {
        if (!isBuiltinOrderKey(type, key)) {
            const style = normalized.styles.find(item => item.id === key);
            return !!style && !style.hidden;
        }
        return type === "style1" ?
            isBuiltinInlineStyleVisible("style1", key as TBuiltinInlineStyleID, normalized) :
            isBuiltinInlineStyleVisible(type, Number(key), normalized);
    });
};

export const getBuiltinInlineStyleIDFromValue = (value?: string): TBuiltinInlineStyleID | undefined => {
    const id = value?.match(/--b3-(?:inline-builtin-|card-)(error|warning|info|success)-(?:background(?:-color)?|color)/)?.[1];
    return BUILTIN_INLINE_STYLE_IDS.includes(id as TBuiltinInlineStyleID) ? id as TBuiltinInlineStyleID : undefined;
};

export const isRecentInlineStyleVisible = (value: string, data = getInlineStylesCache()) => {
    const [type, propertyValue] = value.split(INLINE_STYLE_SEPARATOR);
    if (type === "color") {
        const index = Number(propertyValue?.match(BUILTIN_FONT_COLOR_VARIABLE_PATTERN)?.[1]);
        if (index) {
            return isBuiltinInlineStyleVisible("color", index, data);
        }
    } else if (type === "backgroundColor") {
        const index = Number(propertyValue?.match(BUILTIN_BACKGROUND_COLOR_VARIABLE_PATTERN)?.[1]);
        if (index) {
            return isBuiltinInlineStyleVisible("backgroundColor", index, data);
        }
    } else if (type === "style1") {
        const id = getBuiltinInlineStyleIDFromValue(value);
        if (id) {
            return isBuiltinInlineStyleVisible("style1", id, data);
        }
    }
    const style = getInlineStyleByValue(value, data);
    return !style || !style.hidden;
};

export const filterHiddenRecentInlineStyles = (values: string[], data = getInlineStylesCache()) =>
    values.filter(value => isRecentInlineStyleVisible(value, data));

export const getRecentInlineStyleKey = (value: string) => {
    const id = getInlineStyleIDFromValue(value);
    if (!id) {
        return value;
    }
    return value.split(INLINE_STYLE_SEPARATOR)[0] + INLINE_STYLE_SEPARATOR + id;
};

export const getInlineStylesCSS = (data: unknown = getInlineStylesCache()) => {
    const normalized = normalizeInlineStyles(data);
    return (["light", "dark"] as TInlineStyleMode[]).map(mode => {
        const declarations: string[] = [];
        const contentDeclarations: string[] = [];
        normalized.builtin.colors.forEach(color => {
            if (color[mode].color) {
                declarations.push(`  ${getBuiltinColorVariableName(color.index, "color")}: ${color[mode].color};`);
            }
            if (color[mode].backgroundColor) {
                declarations.push(`  ${getBuiltinColorVariableName(color.index, "backgroundColor")}: ` +
                    `${color[mode].backgroundColor};`);
            }
        });
        normalized.av.colors.forEach(color => {
            declarations.push(`  ${getBuiltinColorVariableName(color.index, "color")}: ${color[mode].color};`);
            declarations.push(`  ${getBuiltinColorVariableName(color.index, "backgroundColor")}: ` +
                `${color[mode].backgroundColor};`);
        });
        normalized.builtin.styles.forEach(style => {
            if (style[mode].color) {
                declarations.push(`  ${getBuiltinInlineStyleVariableName(style.id, "color")}: ${style[mode].color};`);
                contentDeclarations.push(`  ${getBuiltinInlineStyleLegacyVariableName(style.id, "color")}: ` +
                    `var(${getBuiltinInlineStyleVariableName(style.id, "color")});`);
            }
            if (style[mode].backgroundColor) {
                declarations.push(`  ${getBuiltinInlineStyleVariableName(style.id, "backgroundColor")}: ` +
                    `${style[mode].backgroundColor};`);
                contentDeclarations.push(`  ${getBuiltinInlineStyleLegacyVariableName(style.id, "backgroundColor")}: ` +
                    `var(${getBuiltinInlineStyleVariableName(style.id, "backgroundColor")});`);
            }
        });
        normalized.styles.forEach(style => {
            if (style[mode].color) {
                declarations.push(`  ${getInlineStyleVariableName(style.id, "color")}: ${style[mode].color};`);
            }
            if (style[mode].backgroundColor) {
                declarations.push(`  ${getInlineStyleVariableName(style.id, "backgroundColor")}: ${style[mode].backgroundColor};`);
            }
        });
        const blocks: string[] = [];
        if (declarations.length > 0) {
            blocks.push(`:root[data-theme-mode="${mode}"] {\n${declarations.join("\n")}\n}`);
        }
        if (contentDeclarations.length > 0) {
            blocks.push(`:root[data-theme-mode="${mode}"] .protyle-wysiwyg,\n` +
                `:root[data-theme-mode="${mode}"] .b3-typography {\n${contentDeclarations.join("\n")}\n}`);
        }
        return blocks.join("\n");
    }).filter(Boolean).join("\n");
};
