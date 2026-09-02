const INLINE_FONT_FAMILY_PREFIX = "var(--b3-font-family-emoji-reset)";
const INLINE_FONT_FAMILY_SUFFIX = "var(--b3-font-family-editor), var(--b3-font-family)";
const LEGACY_INLINE_FONT_FAMILY_PREFIX = /^(?:"Emojis Additional"|'Emojis Additional')\s*,\s*(?:"Emojis Reset"|'Emojis Reset')\s*,/i;
const INLINE_FONT_FAMILY_SUFFIX_PATTERN = /,\s*var\(--b3-font-family-editor\)\s*,\s*var\(--b3-font-family\)\s*$/i;

export const INLINE_FONT_FAMILY_EXCLUDED_TYPES = ["code", "kbd", "inline-math"];
export const FONT_FAMILY_EXCLUDED_BLOCK_TYPES = ["NodeCodeBlock", "NodeMathBlock", "NodeAttributeView"];

const escapeCSSString = (value: string) => Array.from(value).map(character => {
    const codePoint = character.codePointAt(0);
    if (character === '"') {
        return "\\22 ";
    }
    if (character === "'" || character === "\\") {
        return `\\${character}`;
    }
    if (codePoint < 32 || codePoint === 127) {
        return `\\${codePoint.toString(16)} `;
    }
    return character;
}).join("");

const unescapeCSSString = (value: string) => value.replace(/\\([0-9a-fA-F]{1,6})(?:\s)?|\\([\s\S])/g,
    (match, hex: string, escaped: string) => {
        if (!hex) {
            return escaped;
        }
        const codePoint = parseInt(hex, 16);
        return codePoint === 0 || codePoint > 0x10FFFF ? "�" : String.fromCodePoint(codePoint);
    });

export const getInlineFontFamilyStyle = (family?: string) => family ?
    `${INLINE_FONT_FAMILY_PREFIX}, '${escapeCSSString(family)}', ${INLINE_FONT_FAMILY_SUFFIX}` :
    "";

export const getInlineFontFamilyName = (fontFamily?: string) => {
    const value = fontFamily?.trim();
    if (!value) {
        return;
    }
    const families: string[] = [];
    let escaped = false;
    let parentheses = 0;
    let quote = "";
    let start = 0;
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (escaped) {
            escaped = false;
        } else if (character === "\\") {
            escaped = true;
        } else if (quote) {
            if (character === quote) {
                quote = "";
            }
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === "(") {
            parentheses++;
        } else if (character === ")") {
            parentheses = Math.max(0, parentheses - 1);
        } else if (character === "," && parentheses === 0) {
            families.push(value.slice(start, index));
            start = index + 1;
        }
    }
    families.push(value.slice(start));
    for (const item of families) {
        let family = item.trim();
        if (family.length > 1 && ((family.startsWith('"') && family.endsWith('"')) ||
            (family.startsWith("'") && family.endsWith("'")))) {
            family = family.slice(1, -1);
        }
        family = unescapeCSSString(family);
        const normalized = family.toLowerCase();
        if (family && normalized !== "emojis additional" && normalized !== "emojis reset" &&
            !["inherit", "initial", "revert", "revert-layer", "unset"].includes(normalized) &&
            !normalized.startsWith("var(")) {
            return family;
        }
    }
};

export const normalizeInlineFontFamilyStyle = (fontFamily?: string) => {
    const value = fontFamily?.trim();
    if (!value || !LEGACY_INLINE_FONT_FAMILY_PREFIX.test(value) ||
        !INLINE_FONT_FAMILY_SUFFIX_PATTERN.test(value)) {
        return fontFamily;
    }
    return getInlineFontFamilyStyle(getInlineFontFamilyName(value));
};

export const hasInlineFontFamilyExcludedType = (types: string[]) =>
    INLINE_FONT_FAMILY_EXCLUDED_TYPES.some(type => types.includes(type));

export const getInlineFontFamilySelection = (fontFamilies: (string | undefined)[], eligible: boolean) => {
    if (!eligible || fontFamilies.length === 0) {
        return {disabled: true, family: undefined, mixed: false};
    }
    const families = [...new Set(fontFamilies.map(getInlineFontFamilyName))];
    if (families.length > 1) {
        return {disabled: false, family: undefined, mixed: true};
    }
    return {disabled: false, family: families[0], mixed: false};
};
