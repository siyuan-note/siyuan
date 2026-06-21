// Lute 配置全部读取全局 window.siyuan.config / window.siyuan.emojis，跨编辑器一致，
// 因此所有 Protyle 编辑器共用同一个 Lute 实例，将内存与初始化开销从 O(编辑器数) 降为 O(1)。
// AgentChat 维持自身的独立 Lute.New() 实例，不经过此处。
let luteInstance: Lute | undefined;

/**
 * 获取（首次调用时创建）共享 Lute 单例。
 *
 * 仅在首次创建时应用 options，后续调用直接返回已缓存的实例 ——
 * Lute 配置本就源于全局 config，跨编辑器一致，无需按编辑器区分。
 */
export const getLute = (options: ILuteOptions): Lute => {
    if (!luteInstance) {
        luteInstance = setLute(options);
    }
    return luteInstance;
};

/**
 * 直接获取已初始化的共享 Lute 单例。
 * 供 emoji 等无需传入 options 的场景使用；尚未创建时返回 undefined。
 */
export const getLuteInstance = (): Lute | undefined => {
    return luteInstance;
};

/**
 * 根据全局配置与传入选项构建一个新的 Lute 实例，供共享单例初始化使用。
 */
const setLute = (options: ILuteOptions) => {
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
    lute.SetCallout(true);
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
    lute.SetUnorderedListMarker("-");
    lute.SetDataTask(true);
    lute.SetExportNormalizeTaskListMarker(true);
    lute.SetArbitraryTaskListItemMarker(true);
    lute.SetEnsureListItemParagraph(true); // 空列表项下创建子列表前补一个空段落
    return lute;
};
