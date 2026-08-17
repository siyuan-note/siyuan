const OFFICE_MATH_CONDITIONAL_COMMENT = /<!--\s*\[if\s+gte\s+msEquation\s+\d+\]\s*>([\s\S]*?)<!\s*\[endif\]\s*-->/gi;

export const extractOfficeMathHTML = (html: string) => {
    if (!html) {
        return "";
    }
    return Array.from(html.matchAll(OFFICE_MATH_CONDITIONAL_COMMENT), match => match[1].trim())
        .filter(Boolean)
        .join("");
};
