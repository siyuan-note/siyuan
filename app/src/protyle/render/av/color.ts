import {escapeAttr} from "../../../util/escape";
import {
    AV_BUILTIN_COLOR_COUNT,
    AV_CUSTOM_COLOR_LIMIT,
    AV_CUSTOM_COLOR_MAX,
    AV_CUSTOM_COLOR_MIN,
    getInlineStylesCache,
    getVisibleBuiltinColorIndexes,
    isBuiltinInlineStyleVisible,
} from "../../toolbar/inlineStyle";

export {
    AV_BUILTIN_COLOR_COUNT,
    AV_CUSTOM_COLOR_LIMIT,
    AV_CUSTOM_COLOR_MAX,
    AV_CUSTOM_COLOR_MIN,
};
export const AV_MANAGE_CUSTOM_COLORS_TYPE = "manageAVCustomColors";

type TAVColorReference = string | {
    color?: string,
    resolvedColor?: IAVColor,
};

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export const normalizeAVColorIndex = (color: string | number) => {
    const value = typeof color === "number" ? color.toString() : color;
    if (!/^\d+$/.test(value)) {
        return AV_BUILTIN_COLOR_COUNT;
    }
    const index = Number(value);
    return Number.isInteger(index) && index >= 1 && index <= AV_CUSTOM_COLOR_MAX ?
        index : AV_BUILTIN_COLOR_COUNT;
};

const getColorReference = (value: TAVColorReference) => typeof value === "string" ? {
    color: value,
    resolvedColor: undefined as IAVColor | undefined,
} : value;

const isResolvedColor = (color: IAVColor | undefined): color is IAVColor => !!color &&
    COLOR_PATTERN.test(color.light?.color) && COLOR_PATTERN.test(color.light?.backgroundColor) &&
    COLOR_PATTERN.test(color.dark?.color) && COLOR_PATTERN.test(color.dark?.backgroundColor);

const getModeColor = (light: string, dark: string) => `light-dark(${light}, ${dark})`;

const cssVarsForIndex = (index: number) =>
    `background-color:var(--b3-font-background${index});color:var(--b3-font-color${index})`;

const hasWorkspaceCustomColor = (index: number) =>
    getInlineStylesCache().av.colors.some(item => item.index === index);

export const getAVColorStyle = (value: TAVColorReference) => {
    const reference = getColorReference(value);
    if (isResolvedColor(reference.resolvedColor)) {
        return `background-color:${getModeColor(reference.resolvedColor.light.backgroundColor,
            reference.resolvedColor.dark.backgroundColor)};color:${getModeColor(reference.resolvedColor.light.color,
            reference.resolvedColor.dark.color)}`;
    }
    const index = normalizeAVColorIndex(reference.color || AV_BUILTIN_COLOR_COUNT);
    if (index > AV_BUILTIN_COLOR_COUNT && hasWorkspaceCustomColor(index)) {
        return cssVarsForIndex(index);
    }
    if (index > AV_BUILTIN_COLOR_COUNT) {
        return cssVarsForIndex(AV_BUILTIN_COLOR_COUNT);
    }
    return cssVarsForIndex(index);
};

export const getAVBackgroundColor = (value: TAVColorReference) => {
    const reference = getColorReference(value);
    if (isResolvedColor(reference.resolvedColor)) {
        return getModeColor(reference.resolvedColor.light.backgroundColor,
            reference.resolvedColor.dark.backgroundColor);
    }
    const index = normalizeAVColorIndex(reference.color || AV_BUILTIN_COLOR_COUNT);
    if (index > AV_BUILTIN_COLOR_COUNT && hasWorkspaceCustomColor(index)) {
        return `var(--b3-font-background${index})`;
    }
    if (index > AV_BUILTIN_COLOR_COUNT) {
        return `var(--b3-font-background${AV_BUILTIN_COLOR_COUNT})`;
    }
    return `var(--b3-font-background${index})`;
};

export const getNextAVOptionColor = (optionCount: number) => {
    const colors = getVisibleBuiltinColorIndexes("av");
    if (colors.length === 0) {
        return AV_BUILTIN_COLOR_COUNT.toString();
    }
    return colors[Math.max(0, optionCount) % colors.length].toString();
};

export const getAvailableAVCustomColorIndex = (colors: Pick<IAVCustomColor, "index">[]) => {
    const usedIndexes = new Set(colors.map(item => item.index));
    for (let index = AV_CUSTOM_COLOR_MIN; index <= AV_CUSTOM_COLOR_MAX; index++) {
        if (!usedIndexes.has(index)) {
            return index;
        }
    }
};

const normalizeAVCustomColors = (colors: IAVCustomColor[]) => colors
    .filter(item => item.index >= AV_CUSTOM_COLOR_MIN && item.index <= AV_CUSTOM_COLOR_MAX)
    .sort((a, b) => a.index - b.index)
    .slice(0, AV_CUSTOM_COLOR_LIMIT);

export const getDefaultAVColorOrder = (customColors: Pick<IAVCustomColor, "index">[] = []) => [
    ...Array.from({length: AV_BUILTIN_COLOR_COUNT}, (_, index) => (index + 1).toString()),
    ...normalizeAVCustomColors(customColors as IAVCustomColor[]).map(item => item.index.toString()),
];

export const normalizeAVColorOrder = (order: string[] | undefined, customColors: Pick<IAVCustomColor, "index">[] = []) => {
    const allowed = new Set(getDefaultAVColorOrder(customColors));
    const result: string[] = [];
    const seen = new Set<string>();
    (order || []).forEach(key => {
        if (typeof key !== "string" || !allowed.has(key) || seen.has(key)) {
            return;
        }
        seen.add(key);
        result.push(key);
    });
    getDefaultAVColorOrder(customColors).forEach(key => {
        if (!seen.has(key)) {
            result.push(key);
        }
    });
    return result;
};

export const getAVCustomColors = () => getInlineStylesCache().av.colors;

export const getAVColorOrder = () =>
    normalizeAVColorOrder(getInlineStylesCache().av.order, getAVCustomColors());

export const getAVResolvedColor = (color: string) => {
    const index = normalizeAVColorIndex(color);
    return getAVCustomColors().find(item => item.index === index);
};

export const getAVColorGridHTML = (customColors: IAVCustomColor[], currentColor: string,
                                   manageLabel: string, order?: string[]) => {
    const currentIndex = normalizeAVColorIndex(currentColor);
    const colors: TAVColorReference[] = [];
    const customByIndex = new Map(normalizeAVCustomColors(customColors).map(item => [item.index.toString(), item]));
    normalizeAVColorOrder(order, customColors).forEach(key => {
        const index = Number(key);
        if (index >= 1 && index <= AV_BUILTIN_COLOR_COUNT) {
            if (isBuiltinInlineStyleVisible("av", index)) {
                colors.push({color: key});
            }
            return;
        }
        const custom = customByIndex.get(key);
        if (custom && !custom.hidden) {
            colors.push({
                color: custom.index.toString(),
                resolvedColor: custom,
            });
        }
    });
    const colorHTML = colors.map(item => {
        const reference = getColorReference(item);
        const index = normalizeAVColorIndex(reference.color);
        return `<button type="button" data-color="${index}" class="color__square${currentIndex === index ?
            " color__square--current" : ""}" style="${getAVColorStyle(item)}">A</button>`;
    }).join("");
    return colorHTML + `<button type="button" data-type="${AV_MANAGE_CUSTOM_COLORS_TYPE}" ` +
        `class="color__square ariaLabel" aria-label="${escapeAttr(manageLabel)}">` +
        '<svg class="svg--mid"><use xlink:href="#iconSettings"></use></svg></button>';
};

const mountedPaletteIndexes = new WeakMap<HTMLElement, number[]>();

export const applyAVColorPalette = (element: HTMLElement, customColors: IAVCustomColor[] = []) => {
    mountedPaletteIndexes.get(element)?.forEach(index => {
        element.style.removeProperty(`--b3-font-color${index}`);
        element.style.removeProperty(`--b3-font-background${index}`);
    });
    const indexes: number[] = [];
    normalizeAVCustomColors(customColors).forEach(item => {
        if (!isResolvedColor(item)) {
            return;
        }
        indexes.push(item.index);
        element.style.setProperty(`--b3-font-color${item.index}`,
            getModeColor(item.light.color, item.dark.color));
        element.style.setProperty(`--b3-font-background${item.index}`,
            getModeColor(item.light.backgroundColor, item.dark.backgroundColor));
    });
    mountedPaletteIndexes.set(element, indexes);
};
