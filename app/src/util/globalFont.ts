export const getGlobalFontStyle = (fonts: Array<{family: string}>) => {
    const families = fonts.map((font) => CSS.escape(font.family)).join(", ");
    return families ? `\n:root:root { --b3-font-family: var(--b3-font-family-emoji-reset), ${families}, var(--b3-font-family-default, sans-serif) }` : "";
};
