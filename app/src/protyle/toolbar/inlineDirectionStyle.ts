export type TInlineDirection = "ltr" | "rtl";

export const normalizeInlineDirection = (direction?: string): TInlineDirection | undefined =>
    direction === "ltr" || direction === "rtl" ? direction : undefined;

export const setInlineDirectionStyle = (style: CSSStyleDeclaration, direction?: string) => {
    const normalizedDirection = normalizeInlineDirection(direction);
    if (normalizedDirection) {
        style.direction = normalizedDirection;
        style.unicodeBidi = "isolate";
    } else {
        style.removeProperty("direction");
        style.removeProperty("unicode-bidi");
    }
};

export const hasInlineDirectionStyle = (style: CSSStyleDeclaration, direction?: string) => {
    const normalizedDirection = normalizeInlineDirection(direction);
    if (!normalizedDirection) {
        return !style.direction && !style.unicodeBidi;
    }
    return style.direction === normalizedDirection && style.unicodeBidi === "isolate";
};

export const hasSameInlineDirectionStyle = (current: CSSStyleDeclaration, side: CSSStyleDeclaration) =>
    current.direction === side.direction && current.unicodeBidi === side.unicodeBidi;
