declare const echarts: {
    init(element: HTMLElement, theme?: string, options?: { width: number }): IEChart;
    dispose(element: Element): void;
    getInstanceById(id: string): { resize: () => void };
};

declare const hljs: {
    highlight(text: string, options: { language?: string, ignoreIllegals: boolean }): { value: string };
    getLanguage(text: string): { name: string };
};

interface IEChart {
    setOption(option: any): void;

    getZr(): any;

    on(name: string, event: (e: any) => void): any;

    containPixel(name: string, position: number[]): any;

    resize(): void;
}

interface ILuteNode {
    TokensStr: () => string;
    __internal_object__: {
        Parent: {
            Type: number,
        },
        HeadingLevel: string,
    };
}

type ILuteRenderCallback = (node: ILuteNode, entering: boolean) => [string, number];

/** @link https://ld246.com/article/1588412297062 */
interface ILuteRender {
    renderDocument?: ILuteRenderCallback;
    renderParagraph?: ILuteRenderCallback;
    renderText?: ILuteRenderCallback;
    renderCodeBlock?: ILuteRenderCallback;
    renderCodeBlockOpenMarker?: ILuteRenderCallback;
    renderCodeBlockInfoMarker?: ILuteRenderCallback;
    renderCodeBlockCode?: ILuteRenderCallback;
    renderCodeBlockCloseMarker?: ILuteRenderCallback;
    renderMathBlock?: ILuteRenderCallback;
    renderMathBlockOpenMarker?: ILuteRenderCallback;
    renderMathBlockContent?: ILuteRenderCallback;
    renderMathBlockCloseMarker?: ILuteRenderCallback;
    renderBlockquote?: ILuteRenderCallback;
    renderBlockquoteMarker?: ILuteRenderCallback;
    renderHeading?: ILuteRenderCallback;
    renderHeadingC8hMarker?: ILuteRenderCallback;
    renderList?: ILuteRenderCallback;
    renderListItem?: ILuteRenderCallback;
    renderTaskListItemMarker?: ILuteRenderCallback;
    renderThematicBreak?: ILuteRenderCallback;
    renderHTML?: ILuteRenderCallback;
    renderTable?: ILuteRenderCallback;
    renderTableHead?: ILuteRenderCallback;
    renderTableRow?: ILuteRenderCallback;
    renderTableCell?: ILuteRenderCallback;
    renderCodeSpan?: ILuteRenderCallback;
    renderCodeSpanOpenMarker?: ILuteRenderCallback;
    renderCodeSpanContent?: ILuteRenderCallback;
    renderCodeSpanCloseMarker?: ILuteRenderCallback;
    renderInlineMath?: ILuteRenderCallback;
    renderInlineMathOpenMarker?: ILuteRenderCallback;
    renderInlineMathContent?: ILuteRenderCallback;
    renderInlineMathCloseMarker?: ILuteRenderCallback;
    renderEmphasis?: ILuteRenderCallback;
    renderEmAsteriskOpenMarker?: ILuteRenderCallback;
    renderEmAsteriskCloseMarker?: ILuteRenderCallback;
    renderEmUnderscoreOpenMarker?: ILuteRenderCallback;
    renderEmUnderscoreCloseMarker?: ILuteRenderCallback;
    renderStrong?: ILuteRenderCallback;
    renderStrongA6kOpenMarker?: ILuteRenderCallback;
    renderStrongA6kCloseMarker?: ILuteRenderCallback;
    renderStrongU8eOpenMarker?: ILuteRenderCallback;
    renderStrongU8eCloseMarker?: ILuteRenderCallback;
    renderStrikethrough?: ILuteRenderCallback;
    renderStrikethrough1OpenMarker?: ILuteRenderCallback;
    renderStrikethrough1CloseMarker?: ILuteRenderCallback;
    renderStrikethrough2OpenMarker?: ILuteRenderCallback;
    renderStrikethrough2CloseMarker?: ILuteRenderCallback;
    renderHardBreak?: ILuteRenderCallback;
    renderSoftBreak?: ILuteRenderCallback;
    renderInlineHTML?: ILuteRenderCallback;
    renderLink?: ILuteRenderCallback;
    renderOpenBracket?: ILuteRenderCallback;
    renderCloseBracket?: ILuteRenderCallback;
    renderOpenParen?: ILuteRenderCallback;
    renderCloseParen?: ILuteRenderCallback;
    renderLinkText?: ILuteRenderCallback;
    renderLinkSpace?: ILuteRenderCallback;
    renderLinkDest?: ILuteRenderCallback;
    renderLinkTitle?: ILuteRenderCallback;
    renderImage?: ILuteRenderCallback;
    renderBang?: ILuteRenderCallback;
    renderEmoji?: ILuteRenderCallback;
    renderEmojiUnicode?: ILuteRenderCallback;
    renderEmojiImg?: ILuteRenderCallback;
    renderEmojiAlias?: ILuteRenderCallback;
    renderBackslash?: ILuteRenderCallback;
    renderBackslashContent?: ILuteRenderCallback;
}

interface IBreadcrumb {
    id: string,
    name: string,
    type: string,
    subType: string,
    children: []
}

interface ILuteOptions extends IMarkdownConfig {
    emojis: IObject;
    emojiSite: string;
    headingAnchor: boolean;
    lazyLoadImage?: string;
}

declare class Lute {
    public static WalkStop: number;
    public static WalkSkipChildren: number;
    public static WalkContinue: number;
    public static Version: string;
    public static Caret: string;

    public static New(): Lute;

    public static EChartsMindmapStr(text: string): string;

    public static NewNodeID(): string;

    public static Sanitize(html: string): string;

    public static EscapeHTMLStr(str: string): string;

    public static UnEscapeHTMLStr(str: string): string;

    public static GetHeadingID(node: ILuteNode): string;

    public static BlockDOM2Content(html: string): string;

    private constructor();

    public BlockDOM2Content(text: string): string;

    public BlockDOM2EscapeMarkerContent(text: string): string;

    public SetTextMark(enable: boolean): void;

    public SetHeadingID(enable: boolean): void;

    public SetProtyleMarkNetImg(enable: boolean): void;

    public SetSpellcheck(enable: boolean): void;

    public SetFileAnnotationRef(enable: boolean): void;

    public SetSetext(enable: boolean): void;

    public SetYamlFrontMatter(enable: boolean): void;

    public SetChineseParagraphBeginningSpace(enable: boolean): void;

    public SetRenderListStyle(enable: boolean): void;

    public SetImgPathAllowSpace(enable: boolean): void;

    public SetKramdownIAL(enable: boolean): void;

    public BlockDOM2Md(html: string): string;

    public BlockDOM2StdMd(html: string): string;

    public SetGitConflict(enable: boolean): void;

    public SetSuperBlock(enable: boolean): void;

    public SetTag(enable: boolean): void;

    public SetMark(enable: boolean): void;

    public SetSub(enable: boolean): void;

    public SetSup(enable: boolean): void;

    public SetBlockRef(enable: boolean): void;

    public SetSanitize(enable: boolean): void;

    public SetHeadingAnchor(enable: boolean): void;

    public SetImageLazyLoading(imagePath: string): void;

    public SetInlineMathAllowDigitAfterOpenMarker(enable: boolean): void;

    public SetToC(enable: boolean): void;

    public SetIndentCodeBlock(enable: boolean): void;

    public SetParagraphBeginningSpace(enable: boolean): void;

    public SetFootnotes(enable: boolean): void;

    public SetLinkRef(enalbe: boolean): void;

    public SetEmojiSite(emojiSite: string): void;

    public PutEmojis(emojis: IObject): void;

    public SpinBlockDOM(html: string): string;

    public Md2BlockDOM(html: string): string;

    public SetProtyleWYSIWYG(wysiwyg: boolean): void;

    public MarkdownStr(name: string, md: string): string;

    public IsValidLinkDest(text: string): boolean;

    public BlockDOM2InlineBlockDOM(html: string): string;

    public BlockDOM2HTML(html: string): string;
}

declare const webkitAudioContext: {
    prototype: AudioContext
    new(contextOptions?: AudioContextOptions): AudioContext,
};

/** @link https://ld246.com/article/1549638745630#options-upload */
interface IUpload {
    /** 上传 url */
    url?: string;
    /** 上传文件最大 Byte */
    max?: number;
    /** 剪切板中包含图片地址时，使用此 url 重新上传 */
    linkToImgUrl?: string;
    /** CORS 上传验证，头为 X-Upload-Token */
    token?: string;
    /** 文件上传类型，同 [input accept](https://www.w3schools.com/tags/att_input_accept.asp) */
    accept?: string;
    /** 跨站点访问控制。默认值: false */
    withCredentials?: boolean;
    /** 请求头设置 */
    headers?: IObject;
    /** 额外请求参数 */
    extraData?: { [key: string]: string | Blob };
    /** 上传字段名。默认值：file[] */
    fieldName?: string;

    /** 每次上传前都会重新设置请求头 */
    setHeaders?(): IObject;

    /** 上传成功回调 */
    success?(editor: HTMLDivElement, msg: string): void;

    /** 上传失败回调 */
    error?(msg: string): void;

    /** 文件名安全处理。 默认值: name => name.replace(/\W/g, '') */
    filename?(name: string): string;

    /** 校验，成功时返回 true 否则返回错误信息 */
    validate?(files: File[]): string | boolean;

    /** 自定义上传，当发生错误时返回错误信息 */
    handler?(files: File[]): string | null;

    /** 对服务端返回的数据进行转换，以满足内置的数据结构 */
    format?(files: File[], responseText: string): string;

    /** 将上传的文件处理后再返回  */
    file?(files: File[]): File[];

    /** 图片地址上传后的回调  */
    linkToImgCallback?(responseText: string): void;
}

/** @link https://ld246.com/article/1549638745630#options-toolbar */
interface IMenuItem {
    /** 唯一标示 */
    name: string;
    lang?: string;
    /** svg 图标 */
    icon?: string;
    /** 提示 */
    tip?: string;
    /** 快捷键 */
    hotkey?: string;
    /** 插入编辑器中的后缀 */
    tipPosition?: string;
}

/** @link https://ld246.com/article/1549638745630#options-preview-markdown */
interface IMarkdownConfig {
    /** 段落开头是否空两格。默认值: false */
    paragraphBeginningSpace?: boolean;
    /** 是否启用过滤 XSS。默认值: true */
    sanitize?: boolean;
    /** 为列表添加标记，以便[自定义列表样式](https://github.com/Vanessa219/vditor/issues/390) 默认值：false */
    listStyle?: boolean;
}

/** @link https://ld246.com/article/1549638745630#options-preview */
interface IPreview {
    /** 预览 debounce 毫秒间隔。默认值: 1000 */
    delay?: number;
    /** 显示模式。默认值: 'both' */
    mode?: "both" | "editor";
    /** md 解析请求 */
    url?: string;
    /** @link https://ld246.com/article/1549638745630#options-preview-markdown */
    markdown?: IMarkdownConfig;
    /** @link https://ld246.com/article/1549638745630#options-preview-actions  */
    actions?: Array<IPreviewAction | IPreviewActionCustom>;

    /** 渲染之前回调 */
    transform?(html: string): string;
}

type IPreviewAction = "desktop" | "tablet" | "mobile" | "mp-wechat" | "zhihu" | "yuque";

interface IPreviewActionCustom {
    /** 键名 */
    key: string;
    /** 按钮文本 */
    text: string;
    /** 按钮 className 值 */
    className?: string;
    /** 点击回调 */
    click: (key: string) => void;
}

interface IHintData {
    html: string;
    value: string;
    filter?: string[]
    focus?: boolean
}

interface IHintExtend {
    key: string;

    hint?(value: string, protyle: IProtyle): IHintData[];
}

/** @link https://ld246.com/article/1549638745630#options-hint */
interface IHint {
    /** 常用表情提示 HTML */
    emojiTail?: string;
    /** 提示 debounce 毫秒间隔。默认值: 200 */
    delay?: number;
    /** 默认表情，可从 [lute/emoji_map](https://github.com/88250/lute/blob/master/parse/emoji_map.go#L32) 中选取，也可自定义 */
    emoji?: IObject;
    emojiPath?: string;
    extend?: IHintExtend[];
}

/** @link https://ld246.com/article/1549638745630#options */
interface IOptions {
    backlinkData?: {
        blockPaths: IBreadcrumb[],
        dom: string
        expand: boolean
    }[],
    action?: string[],
    mode?: TEditorMode,
    blockId: string
    key?: string
    scrollAttr?: IScrollAttr
    defId?: string
    render?: {
        background?: boolean
        title?: boolean
        gutter?: boolean
        scroll?: boolean
        breadcrumb?: boolean
        breadcrumbDocName?: boolean
    }
    /** 内部调试时使用 */
    _lutePath?: string;
    /** 是否显示日志。默认值: false */
    debugger?: boolean;
    /** 是否启用打字机模式。默认值: false */
    typewriterMode?: boolean;
    /** 多语言。默认值: 'zh_CN' */
    lang?: string;
    /** @link https://ld246.com/article/1549638745630#options-toolbar */
    toolbar?: Array<string | IMenuItem>;
    /** @link https://ld246.com/article/1549638745630#options-preview */
    preview?: IPreview;
    /** @link https://ld246.com/article/1549638745630#options-hint */
    hint?: IHint;
    /** @link https://ld246.com/article/1549638745630#options-upload */
    upload?: IUpload;
    /** @link https://ld246.com/article/1549638745630#options-classes */
    classes?: {
        preview?: string;
    };

    /** 编辑器异步渲染完成后的回调方法 */
    after?(protyle: import("../protyle").Protyle): void;
}

interface IProtyle {
    getInstance: () => import("../protyle").Protyle,
    app: import("../index").App,
    transactionTime: number,
    id: string,
    block: {
        id?: string,
        scroll?: boolean
        parentID?: string,
        parent2ID?: string,
        rootID?: string,
        showAll?: boolean
        mode?: number
        blockCount?: number
        action?: string[]
    },
    disabled: boolean,
    selectElement?: HTMLElement,
    ws?: import("../layout/Model").Model,
    notebookId?: string
    path?: string
    model?: import("../../src/editor").Editor,
    updated: boolean;
    element: HTMLElement;
    scroll?: import("../protyle/scroll").Scroll,
    gutter?: import("../protyle/gutter").Gutter,
    breadcrumb?: import("../protyle/breadcrumb").Breadcrumb,
    title?: import("../protyle/header/Title").Title,
    background?: import("../protyle/header/background").Background,
    contentElement?: HTMLElement,
    options: IOptions;
    lute?: Lute;
    toolbar?: import("../protyle/toolbar").Toolbar,
    preview?: import("../protyle/preview").Preview;
    hint?: import("../protyle/hint").Hint;
    upload?: import("../protyle/upload").Upload;
    undo?: import("../protyle/undo").Undo;
    wysiwyg?: import("../protyle/wysiwyg").WYSIWYG
}
