export interface IFontItem {
    id?: string;
    family: string;
    weight: number;
    displayName: string;
    aliases?: string[];
    spacing?: string;
}

export const parseSystemFontsJSON = (json: string): IFontItem[] => {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) {
        throw new Error("Invalid system font list");
    }
    return value.filter((font): font is IFontItem => font && typeof font.family === "string" &&
        font.family.trim() && typeof font.displayName === "string" &&
        Number.isInteger(font.weight) && font.weight >= 1 && font.weight <= 1000 &&
        (font.aliases === undefined || (Array.isArray(font.aliases) &&
            font.aliases.every((alias: unknown) => typeof alias === "string"))) &&
        (font.spacing === undefined || typeof font.spacing === "string"));
};

export const getFontFamilyDisplayName = (fonts: IFontItem[], family?: string) => {
    if (!family) {
        return family;
    }
    return fonts.find(font => font.family === family)?.displayName || family;
};

export const getUniqueFontFamilies = (fonts: IFontItem[]) => {
    const families = new Map<string, IFontItem>();
    fonts.forEach(font => {
        const current = families.get(font.family);
        if (!current) {
            families.set(font.family, {...font});
            return;
        }
        const aliases = [...new Set([...(current.aliases || []), ...(font.aliases || [])])];
        if (current.weight !== 400 && font.weight === 400) {
            families.set(font.family, {...font, aliases});
        } else {
            current.aliases = aliases;
        }
    });
    return Array.from(families.values()).sort((fontA, fontB) =>
        (fontA.displayName || fontA.family).localeCompare(fontB.displayName || fontB.family));
};
