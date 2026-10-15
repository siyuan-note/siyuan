const getLocalFontRules = (rules: CSSRuleList): string => Array.from(rules).map(rule => {
    if (rule instanceof CSSFontFaceRule) {
        const source = rule.style.getPropertyValue("src");
        return /\blocal\s*\(/i.test(source) && !/\burl\s*\(/i.test(source) ? rule.cssText : "";
    }
    if (rule instanceof CSSGroupingRule) {
        const fonts = getLocalFontRules(rule.cssRules);
        return fonts ? `${rule.cssText.slice(0, rule.cssText.indexOf("{") + 1)}\n${fonts}\n}` : "";
    }
    return "";
}).filter(Boolean).join("\n");

export const getExportImageLocalFontCSS = (ownerDocument: Document) => Array.from(ownerDocument.styleSheets).map(sheet => {
    try {
        return getLocalFontRules(sheet.cssRules);
    } catch {
        // 跨域样式表不可读取，继续使用截图引擎的字体嵌入流程。
        return "";
    }
}).filter(Boolean).join("\n");

export const getExportImageFontCSS = async (element: HTMLElement) => {
    // 本地字体声明保留缩放和字符范围，网络字体仍由截图引擎嵌入。
    const localFonts = getExportImageLocalFontCSS(element.ownerDocument);
    return `${localFonts}\n${await window.htmlToImage.getFontEmbedCSS(element)}`;
};
