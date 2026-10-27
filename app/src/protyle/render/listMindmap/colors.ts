import {
    BUILTIN_INLINE_STYLE_IDS, getBuiltinColorPropertyValue, getBuiltinInlineStylePreview,
    getBuiltinInlineStylePropertyValue, getInlineStyleByID, getInlineStylePreview, getInlineStylePropertyValue,
    getVisibleOrderedStyleKeys, isBuiltinOrderKey,
} from "../../toolbar/inlineStyle";
import type {IInlineStyles, TBuiltinInlineStyleID, TInlineStyleMode, TInlineStyleType} from "../../toolbar/inlineStyle";

const prioritizeColors = <T>(items: {key: string, value: T}[], keys: readonly string[]): T[] => [
    ...keys.flatMap(key => items.filter(item => item.key === key)),
    ...items.filter(item => !keys.includes(item.key)),
].map(item => item.value);

export const getListMindmapLineColors = (data: IInlineStyles, labels: Record<string, string>, mode: TInlineStyleMode) =>
    prioritizeColors(getVisibleOrderedStyleKeys("color", data).map(key => {
        if (isBuiltinOrderKey("color", key)) {
            return {key, value: {label: `${labels.color} ${key}`, value: getBuiltinColorPropertyValue(Number(key), "color")}};
        }
        const style = getInlineStyleByID(key, data);
        return {key, value: {label: style.name, value: getInlineStylePropertyValue(style, "color", mode)}};
    }), ["1", "2", "3", "4", "5", "6"]);

export const getListMindmapNodeColors = (data: IInlineStyles, labels: Record<string, string>, mode: TInlineStyleMode): {
    label: string, color: string, backgroundColor: string, preview?: {color: string, backgroundColor: string},
}[] => {
    const combined = getVisibleOrderedStyleKeys("style1", data).map(key => {
        if (isBuiltinOrderKey("style1", key)) {
            const id = key as TBuiltinInlineStyleID;
            return {key, value: {label: labels[`${key}Style`],
                color: getBuiltinInlineStylePropertyValue(id, "color"),
                backgroundColor: getBuiltinInlineStylePropertyValue(id, "backgroundColor"),
                preview: getBuiltinInlineStylePreview(id, mode, data)}};
        }
        const style = getInlineStyleByID(key, data);
        return {key, value: {label: style.name, ...getInlineStylePreview(style, mode)}};
    });
    // 前四组使用语义组合样式，其余组合沿用现有文字和背景变量，不改写工作空间配置。
    const remaining = getVisibleOrderedStyleKeys("backgroundColor", data)
        .filter(key => isBuiltinOrderKey("backgroundColor", key) && Number(key) > BUILTIN_INLINE_STYLE_IDS.length)
        .map(key => ({key, value: {label: `${labels.color} ${key}`,
            color: getBuiltinColorPropertyValue(Number(key), "color"),
            backgroundColor: getBuiltinColorPropertyValue(Number(key), "backgroundColor")}}));
    return prioritizeColors([...combined, ...remaining], [...BUILTIN_INLINE_STYLE_IDS, "5", "6"]);
};

export const getListMindmapNodeColorMenu = (labels: Record<string, string>, select: (type: TInlineStyleType) => void): IMenu[] =>
    [{label: labels.listMindmapNodeColor, icon: "iconTheme", click: () => select("style1")},
        {label: labels.colorFont, icon: "iconFont", click: () => select("color")},
        {label: labels.colorPrimary, icon: "iconTheme", click: () => select("backgroundColor")}];
