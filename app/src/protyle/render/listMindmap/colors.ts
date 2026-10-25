import {
    BUILTIN_INLINE_STYLE_IDS, getBuiltinColorPropertyValue, getBuiltinInlineStylePreview,
    getBuiltinInlineStylePropertyValue, getInlineStyleByID, getInlineStylePreview, getInlineStylePropertyValue,
    getVisibleOrderedStyleKeys, isBuiltinOrderKey,
} from "../../toolbar/inlineStyle";
import type {IInlineStyles, TBuiltinInlineStyleID, TInlineStyleMode, TInlineStyleType} from "../../toolbar/inlineStyle";

export const getListMindmapLineColors = (data: IInlineStyles, labels: Record<string, string>, mode: TInlineStyleMode) =>
    getVisibleOrderedStyleKeys("color", data).map(key => {
        if (isBuiltinOrderKey("color", key)) {
            return {label: `${labels.color} ${key}`, value: getBuiltinColorPropertyValue(Number(key), "color")};
        }
        const style = getInlineStyleByID(key, data);
        return {label: style.name, value: getInlineStylePropertyValue(style, "color", mode)};
    });

export const getListMindmapNodeColors = (data: IInlineStyles, labels: Record<string, string>, mode: TInlineStyleMode): {
    label: string, color: string, backgroundColor: string, preview?: {color: string, backgroundColor: string},
}[] => {
    const combined = getVisibleOrderedStyleKeys("style1", data).map(key => {
        if (isBuiltinOrderKey("style1", key)) {
            const id = key as TBuiltinInlineStyleID;
            return {label: labels[`${key}Style`],
                color: getBuiltinInlineStylePropertyValue(id, "color"),
                backgroundColor: getBuiltinInlineStylePropertyValue(id, "backgroundColor"),
                preview: getBuiltinInlineStylePreview(id, mode, data)};
        }
        const style = getInlineStyleByID(key, data);
        return {label: style.name, ...getInlineStylePreview(style, mode)};
    });
    // The first four font colors already have semantic combined styles. Complete the
    // remaining pairs without changing their variables or the workspace configuration.
    const remaining = getVisibleOrderedStyleKeys("backgroundColor", data)
        .filter(key => isBuiltinOrderKey("backgroundColor", key) && Number(key) > BUILTIN_INLINE_STYLE_IDS.length)
        .map(key => ({label: `${labels.color} ${key}`,
            color: getBuiltinColorPropertyValue(Number(key), "color"),
            backgroundColor: getBuiltinColorPropertyValue(Number(key), "backgroundColor")}));
    return [...combined, ...remaining];
};

export const getListMindmapNodeColorMenu = (labels: Record<string, string>, select: (type: TInlineStyleType) => void): IMenu[] =>
    [{label: labels.listMindmapNodeColor, icon: "iconTheme", click: () => select("style1")},
        {label: labels.colorFont, icon: "iconFont", click: () => select("color")},
        {label: labels.colorPrimary, icon: "iconTheme", click: () => select("backgroundColor")}];
