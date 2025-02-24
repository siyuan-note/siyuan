export const setLute = (options: ILuteOptions) => {
    const lute: Lute = Lute.New();
    lute.SetSpellcheck(window.siyuan.config.editor.spellcheck);
    lute.SetProtyleMarkNetImg(window.siyuan.config.editor.displayNetImgMark);
    lute.SetFileAnnotationRef(true);
    lute.SetHTMLTag2TextMark(true);
    lute.SetTextMark(true);
    lute.SetHeadingID(false);
    lute.SetYamlFrontMatter(false);
    lute.PutEmojis(options.emojis);
    lute.SetEmojiSite(options.emojiSite);
    lute.SetHeadingAnchor(options.headingAnchor);
    lute.SetInlineMathAllowDigitAfterOpenMarker(true);
    lute.SetToC(false);
    lute.SetIndentCodeBlock(false);
    lute.SetParagraphBeginningSpace(true);
    lute.SetSetext(false);
    lute.SetFootnotes(false);
    lute.SetLinkRef(false);
    lute.SetSanitize(options.sanitize);
    lute.SetChineseParagraphBeginningSpace(options.paragraphBeginningSpace);
    lute.SetRenderListStyle(options.listStyle);
    lute.SetImgPathAllowSpace(true);
    lute.SetKramdownIAL(true);
    lute.SetTag(true);
    lute.SetSuperBlock(true);
    lute.SetMark(true);
    lute.SetInlineAsterisk(window.siyuan.config.editor.markdown.inlineAsterisk);
    lute.SetInlineUnderscore(window.siyuan.config.editor.markdown.inlineUnderscore);
    lute.SetSup(window.siyuan.config.editor.markdown.inlineSup);
    lute.SetSub(window.siyuan.config.editor.markdown.inlineSub);
    lute.SetTag(window.siyuan.config.editor.markdown.inlineTag);
    lute.SetInlineMath(window.siyuan.config.editor.markdown.inlineMath);
    lute.SetGFMStrikethrough1(false);
    lute.SetGFMStrikethrough(window.siyuan.config.editor.markdown.inlineStrikethrough);
    lute.SetMark(window.siyuan.config.editor.markdown.inlineMark);
    lute.SetSpin(true);
    lute.SetProtyleWYSIWYG(true);
    if (options.lazyLoadImage) {
        lute.SetImageLazyLoading(options.lazyLoadImage);
    }
    lute.SetBlockRef(true);
    if (window.siyuan.emojis[0].items.length > 0) {
        const emojis: IObject = {};
        window.siyuan.emojis[0].items.forEach(item => {
            emojis[item.keywords] = options.emojiSite + "/" + item.unicode;
        });
        lute.PutEmojis(emojis);
    }
    return lute;
};
