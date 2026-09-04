export interface IFormatPainterStyle {
    backgroundColor?: string;
    color?: string;
    direction?: "ltr" | "rtl";
    fontFamily?: string;
    fontSize?: string;
    shadow?: boolean;
    hollow?: boolean;
}

export type TFormatPainterMode = "once" | "continuous";

export const shouldKeepFormatPainterActive = (mode: TFormatPainterMode) => mode === "continuous";

export const shouldShowFormatPainterMessage = (enabled?: boolean) => enabled !== false;

export interface IFormatPainterSnapshot {
    styles: IFormatPainterStyle;
    types: string[];
}

export interface IFormatPainterSegment {
    fontFamilyExcluded?: boolean;
    styles: IFormatPainterStyle;
    types: string[];
}

export const FORMAT_PAINTER_TYPES = ["strong", "em", "u", "s", "mark", "sup", "sub", "code", "kbd"];

const getCommonStyles = (segments: IFormatPainterSegment[]) => {
    const styles: IFormatPainterStyle = {};
    const keys: (keyof IFormatPainterStyle)[] = [
        "backgroundColor", "color", "direction", "fontFamily", "fontSize", "shadow", "hollow"
    ];
    keys.forEach(key => {
        const comparableSegments = key === "fontFamily" ?
            segments.filter(item => !item.fontFamilyExcluded) : segments;
        const value = comparableSegments[0]?.styles[key];
        if (value && comparableSegments.every(item => item.styles[key] === value)) {
            (styles as Record<keyof IFormatPainterStyle, string | boolean>)[key] = value;
        }
    });
    return styles;
};

export const getCommonFormatPainterSnapshot = (segments: IFormatPainterSegment[]) => {
    if (segments.length === 0) {
        return;
    }
    return {
        styles: getCommonStyles(segments),
        types: FORMAT_PAINTER_TYPES.filter(type => segments.every(item => item.types.includes(type))),
    } as IFormatPainterSnapshot;
};
