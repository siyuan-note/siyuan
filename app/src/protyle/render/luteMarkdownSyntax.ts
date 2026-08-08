export const applyLuteMarkdownSyntax = (lute: Lute, markdown: Config.IMarkdown) => {
    lute.SetInlineAsterisk(markdown.inlineAsterisk);
    lute.SetInlineUnderscore(markdown.inlineUnderscore);
    lute.SetSup(markdown.inlineSup);
    lute.SetSub(markdown.inlineSub);
    lute.SetTag(markdown.inlineTag);
    lute.SetInlineMath(markdown.inlineMath);
    lute.SetGFMStrikethrough1(false);
    lute.SetGFMStrikethrough(markdown.inlineStrikethrough);
    lute.SetFullWidthStrikethrough(markdown.inlineFullWidthStrikethrough);
    lute.SetMark(markdown.inlineMark);
};
