type TLayout = "normal" | "bottom" | "left" | "right" | "center"
type TSearchFilter = "mathBlock" | "table" | "blockquote" | "superBlock" | "paragraph" | "document" | "heading"
    | "list" | "listItem" | "codeBlock" | "htmlBlock"
type TDirection = "lr" | "tb"
type TPluginDockPosition = "LeftTop" | "LeftBottom" | "RightTop" | "RightBottom" | "BottomLeft" | "BottomRight"
type TDockPosition = "Left" | "Right" | "Bottom"
type TWS = "main" | "filetree" | "protyle"
type TEditorMode = "preview" | "wysiwyg"
type TOperation =
    "insert"
    | "update"
    | "delete"
    | "move"
    | "foldHeading"
    | "unfoldHeading"
    | "setAttrs"
    | "updateAttrs"
    | "append"
    | "insertAttrViewBlock"
    | "removeAttrViewBlock"
    | "addAttrViewCol"
    | "removeAttrViewCol"
    | "addFlashcards"
    | "removeFlashcards"
    | "updateAttrViewCell"
    | "updateAttrViewCol"
    | "sortAttrViewRow"
    | "sortAttrViewCol"
    | "setAttrViewColHidden"
    | "setAttrViewColWrap"
    | "setAttrViewColWidth"
    | "updateAttrViewColOptions"
    | "removeAttrViewColOption"
    | "updateAttrViewColOption"
    | "setAttrViewName"
    | "setAttrViewFilters"
    | "setAttrViewSorts"
    | "setAttrViewColCalc"
    | "updateAttrViewColNumberFormat"
type TBazaarType = "templates" | "icons" | "widgets" | "themes" | "plugins"
type TCardType = "doc" | "notebook" | "all"
type TEventBus = "ws-main" |
    "click-blockicon" | "click-editorcontent" | "click-pdf" | "click-editortitleicon" |
    "open-noneditableblock" |
    "open-menu-blockref" | "open-menu-fileannotationref" | "open-menu-tag" | "open-menu-link" | "open-menu-image" |
    "open-menu-av" | "open-menu-content" | "open-menu-breadcrumbmore" |
    "open-siyuan-url-plugin" | "open-siyuan-url-block" |
    "input-search" |
    "loaded-protyle" | "loaded-protyle-dynamic" |
    "destroy-protyle"
type TAVCol =
    "text"
    | "date"
    | "number"
    | "relation"
    | "rollup"
    | "select"
    | "block"
    | "mSelect"
    | "url"
    | "email"
    | "phone"
type THintSource = "search" | "av" | "hint";
type TAVFilterOperator =
    "="
    | "!="
    | ">"
    | ">="
    | "<"
    | "<="
    | "Contains"
    | "Does not contains"
    | "Is empty"
    | "Is not empty"
    | "Starts with"
    | "Ends with"
    | "Is between"
    | "Is relative to today"
declare module "blueimp-md5"

interface Window {
    pdfjsLib: any
    dataLayer: any[]
    siyuan: ISiyuan
    webkit: any
    html2canvas: (element: Element, opitons: { useCORS: boolean }) => Promise<any>;
    JSAndroid: {
        returnDesktop(): void
        openExternal(url: string): void
        changeStatusBarColor(color: string, mode: number): void
        writeClipboard(text: string): void
        writeImageClipboard(uri: string): void
        readClipboard(): string
        getBlockURL(): string
    }

    newWindow: {
        positionPDF(pathStr: string, page: string | number): void
        switchTabById(id: string): void
    }

    Protyle: import("../protyle/method").default

    goBack(): void

    reconnectWebSocket(): void

    showKeyboardToolbar(height: number): void

    hideKeyboardToolbar(): void

    openFileByURL(URL: string): boolean
}

interface ISaveLayout {
    name: string,
    layout: IObject
}

interface IWorkspace {
    path: string
    closed: boolean
}

interface ICardPackage {
    id: string
    updated: string
    name: string
    size: number
}

interface ICard {
    deckID: string
    cardID: string
    blockID: string
    nextDues: IObject
}

interface IPluginSettingOption {
    title: string
    description?: string
    actionElement?: HTMLElement

    createActionElement?(): HTMLElement
}

interface ISearchAssetOption {
    keys: string[],
    col: string,
    row: string,
    layout: number,
    method: number,
    types: {
        ".txt": boolean,
        ".md": boolean,
        ".docx": boolean,
        ".xlsx": boolean,
        ".pptx": boolean,
    },
    sort: number,
    k: string,
}

interface ISearchOption {
    page: number
    removed?: boolean  // 移除后需记录搜索内容 https://github.com/siyuan-note/siyuan/issues/7745
    name?: string
    sort: number,  //  0：按块类型（默认），1：按创建时间升序，2：按创建时间降序，3：按更新时间升序，4：按更新时间降序，5：按内容顺序（仅在按文档分组时），6：按相关度升序，7：按相关度降序
    group: number,  // 0：不分组，1：按文档分组
    hasReplace: boolean,
    method: number //  0：文本，1：查询语法，2：SQL，3：正则表达式
    hPath: string
    idPath: string[]
    k: string
    r: string
    types: {
        mathBlock: boolean
        table: boolean
        blockquote: boolean
        superBlock: boolean
        paragraph: boolean
        document: boolean
        heading: boolean
        list: boolean
        listItem: boolean
        codeBlock: boolean
        htmlBlock: boolean
        embedBlock: boolean
    }
}

interface ITextOption {
    color?: string,
    type: string
}

interface ISnippet {
    id?: string
    name: string
    type: string
    enabled: boolean
    content: string
}

interface IInbox {
    oId: string
    shorthandContent: string
    shorthandDesc: string
    shorthandFrom: number
    shorthandTitle: string
    shorthandURL: string
    hCreated: string
}

interface IPdfAnno {
    pages?: {
        index: number
        positions: number []
    }[]
    index?: number,
    color: string,
    type: string,   // border, text
    content: string,    // rect, text
    mode: string,
    id?: string,
    coords?: number[]
}

interface IBackStack {
    id: string,
    // 仅移动端
    data?: {
        startId: string,
        endId: string
        path: string
        notebookId: string
    },
    scrollTop?: number,
    callback?: string[],
    position?: { start: number, end: number }
    // 仅桌面端
    protyle?: IProtyle,
    zoomId?: string
}

interface IEmoji {
    id: string,
    title: string,
    title_zh_cn: string,
    items: {
        unicode: string,
        description: string,
        description_zh_cn: string,
        keywords: string
    }[]
}

interface INotebook {
    name: string
    id: string
    closed: boolean
    icon: string
    sort: number
    dueFlashcardCount?: string;
    newFlashcardCount?: string;
    flashcardCount?: string;
    sortMode: number
}

interface ISiyuan {
    zIndex: number
    storage?: { [key: string]: any },
    printWin?: import("electron").BrowserWindow
    transactions?: {
        protyle: IProtyle,
        doOperations: IOperation[],
        undoOperations: IOperation[]
    }[]
    reqIds: { [key: string]: number },
    editorIsFullscreen?: boolean,
    hideBreadcrumb?: boolean,
    notebooks?: INotebook[],
    emojis?: IEmoji[],
    backStack?: IBackStack[],
    mobile?: {
        editor?: import("../protyle").Protyle
        popEditor?: import("../protyle").Protyle
        files?: import("../mobile/dock/MobileFiles").MobileFiles
    },
    user?: {
        userId: string
        userName: string
        userAvatarURL: string
        userHomeBImgURL: string
        userIntro: string
        userNickname: string
        userSiYuanOneTimePayStatus: number  // 0 未付费；1 已付费
        userSiYuanProExpireTime: number // -1 终身会员；0 普通用户；> 0 过期时间
        userSiYuanSubscriptionPlan: number // 0 年付订阅/终生；1 教育优惠；2 订阅试用
        userSiYuanSubscriptionType: number // 0 年付；1 终生；2 月付
        userSiYuanSubscriptionStatus: number // -1：未订阅，0：订阅可用，1：订阅封禁，2：订阅过期
        userToken: string
        userTitles: { name: string, icon: string, desc: string }[]
    },
    dragElement?: HTMLElement,
    layout?: {
        layout?: import("../layout").Layout,
        centerLayout?: import("../layout").Layout,
        leftDock?: import("../layout/dock").Dock,
        rightDock?: import("../layout/dock").Dock,
        bottomDock?: import("../layout/dock").Dock,
    }
    config?: IConfig;
    ws: import("../layout/Model").Model,
    ctrlIsPressed?: boolean,
    altIsPressed?: boolean,
    shiftIsPressed?: boolean,
    coordinates?: {
        pageX: number,
        pageY: number,
        clientX: number,
        clientY: number,
        screenX: number,
        screenY: number,
    },
    menus?: import("../menus").Menus
    languages?: {
        [key: string]: any;
    }
    bookmarkLabel?: string[]
    blockPanels: import("../block/Panel").BlockPanel[],
    dialogs: import("../dialog").Dialog[],
    viewer?: {
        destroyed: boolean,
        show: () => void,
        destroy: () => void,
    }
}

interface IScrollAttr {
    rootId: string,
    startId: string,
    endId: string
    scrollTop: number,
    focusId?: string,
    focusStart?: number
    focusEnd?: number
    zoomInId?: string
}

interface IOperation {
    action: TOperation, // move， delete 不需要传 data
    id?: string,
    avID?: string,  // av
    format?: string // updateAttrViewColNumberFormat 专享
    keyID?: string // updateAttrViewCell 专享
    rowID?: string // updateAttrViewCell 专享
    data?: any, // updateAttr 时为  { old: IObject, new: IObject }, updateAttrViewCell 时为 {TAVCol: {content: string}}
    parentID?: string
    previousID?: string
    retData?: any
    nextID?: string // insert 专享
    srcIDs?: string[] // insertAttrViewBlock 专享
    name?: string // addAttrViewCol 专享
    type?: TAVCol // addAttrViewCol 专享
    deckID?: string // add/removeFlashcards 专享
    blockIDs?: string[] // add/removeFlashcards 专享
}

interface IObject {
    [key: string]: string;
}

interface ILayoutJSON extends ILayoutOptions {
    scrollAttr?: IScrollAttr,
    instance?: string,
    width?: string,
    height?: string,
    title?: string,
    lang?: string
    docIcon?: string
    page?: string
    path?: string
    blockId?: string
    icon?: string
    rootId?: string
    active?: boolean
    pin?: boolean
    isPreview?: boolean
    customModelData?: any
    customModelType?: string
    config?: ISearchOption
    children?: ILayoutJSON[] | ILayoutJSON
}

interface IDockTab {
    type: string;
    size: { width: number, height: number }
    show: boolean
    icon: string
    title: string
    hotkey?: string
    hotkeyLangId?: string   // 常量中无法存变量
}

interface ICommand {
    langKey: string, // 用于区分不同快捷键的 key, 同时作为 i18n 的字段名
    langText?: string, // 显示的文本, 指定后不再使用 langKey 对应的 i18n 文本
    hotkey: string,
    customHotkey?: string,
    callback?: () => void   // 其余回调存在时将不会触
    globalCallback?: () => void // 焦点不在应用内时执行的回调
    fileTreeCallback?: (file: import("../layout/dock/Files").Files) => void // 焦点在文档树上时执行的回调
    editorCallback?: (protyle: IProtyle) => void     // 焦点在编辑器上时执行的回调
    dockCallback?: (element: HTMLElement) => void    // 焦点在 dock 上时执行的回调
}

interface IPluginData {
    displayName: string,
    name: string,
    js: string,
    css: string,
    i18n: IObject
}

interface IPluginDockTab {
    position: TPluginDockPosition,
    size: { width: number, height: number },
    icon: string,
    hotkey?: string,
    title: string,
    index?: number
    show?: boolean
}

interface IOpenFileOptions {
    app: import("../index").App,
    searchData?: ISearchOption, // 搜索必填
    // card 和自定义页签 必填
    custom?: {
        title: string,
        icon: string,
        data?: any
        id: string,
        fn?: (options: {
            tab: import("../layout/Tab").Tab,
            data: any,
        }) => import("../layout/Model").Model,   // plugin 0.8.3 历史兼容
    }
    assetPath?: string, // asset 必填
    fileName?: string, // file 必填
    rootIcon?: string, // 文档图标
    id?: string,  // file 必填
    rootID?: string, // file 必填
    position?: string, // file 或者 asset，打开位置
    page?: number | string, // asset
    mode?: TEditorMode // file
    action?: string[]
    keepCursor?: boolean // file，是否跳转到新 tab 上
    zoomIn?: boolean // 是否缩放
    removeCurrentTab?: boolean // 在当前页签打开时需移除原有页签
    afterOpen?: () => void // 打开后回调
}

interface ILayoutOptions {
    direction?: TDirection;
    size?: string
    resize?: TDirection
    type?: TLayout
    element?: HTMLElement
}

interface ITab {
    icon?: string
    docIcon?: string
    title?: string
    panel?: string
    callback?: (tab: import("../layout/Tab").Tab) => void
}

interface IExport {
    fileAnnotationRefMode: number
    blockRefMode: number
    blockEmbedMode: number
    blockRefTextLeft: string
    blockRefTextRight: string
    tagOpenMarker: string
    tagCloseMarker: string
    pandocBin: string
    paragraphBeginningSpace: boolean;
    addTitle: boolean;
    markdownYFM: boolean;
    pdfFooter: string;
}

interface IEditor {
    justify: boolean;
    fontSizeScrollZoom: boolean;
    rtl: boolean;
    readOnly: boolean;
    listLogicalOutdent: boolean;
    spellcheck: boolean;
    onlySearchForDoc: boolean;
    katexMacros: string;
    fullWidth: boolean;
    floatWindowMode: number;
    dynamicLoadBlocks: number;
    fontSize: number;
    generateHistoryInterval: number;
    historyRetentionDays: number;
    codeLineWrap: boolean;
    displayBookmarkIcon: boolean;
    displayNetImgMark: boolean;
    codeSyntaxHighlightLineNum: boolean;
    embedBlockBreadcrumb: boolean;
    plantUMLServePath: string;
    codeLigatures: boolean;
    codeTabSpaces: number;
    fontFamily: string;
    virtualBlockRef: boolean;
    virtualBlockRefExclude: string;
    virtualBlockRefInclude: string;
    blockRefDynamicAnchorTextMaxLen: number;
    backlinkExpandCount: number;
    backmentionExpandCount: number;

    emoji: string[];
}

interface IWebSocketData {
    cmd?: string
    callback?: string
    data?: any
    msg: string
    code: number
    sid?: string
}

interface IAppearance {
    modeOS: boolean,
    hideStatusBar: boolean,
    themeJS: boolean,
    mode: number, // 1 暗黑；0 明亮
    icon: string,
    closeButtonBehavior: number  // 0：退出，1：最小化到托盘
    codeBlockThemeDark: string
    codeBlockThemeLight: string
    themeDark: string
    themeLight: string
    icons: string[]
    lang: string
    iconVer: string
    themeVer: string
    lightThemes: string[]
    darkThemes: string[]
}

interface IFileTree {
    closeTabsOnStart: boolean
    alwaysSelectOpenedFile: boolean
    openFilesUseCurrentTab: boolean
    removeDocWithoutConfirm: boolean
    useSingleLineSave: boolean
    allowCreateDeeper: boolean
    refCreateSavePath: string
    docCreateSavePath: string
    sort: number
    maxOpenTabCount: number
    maxListCount: number
}

interface IAccount {
    displayTitle: boolean
    displayVIP: boolean
}

interface IConfig {
    cloudRegion: number
    bazaar: {
        trust: boolean
        petalDisabled: boolean
    }
    repo: {
        key: string
    },
    flashcard: {
        newCardLimit: number
        reviewCardLimit: number
        mark: boolean
        list: boolean
        superBlock: boolean
        deck: boolean
    }
    ai: {
        openAI: {
            apiBaseURL: string
            apiKey: string
            apiModel: string
            apiMaxTokens: number
            apiProxy: string
            apiTimeout: number
        },
    }
    sync: {
        generateConflictDoc: boolean
        enabled: boolean
        perception: boolean
        mode: number
        synced: number
        stat: string
        interval: number
        cloudName: string
        provider: number    // 0 官方同步， 2 S3， 3 WebDAV
        s3: {
            endpoint: string
            pathStyle: boolean
            accessKey: string
            secretKey: string
            bucket: string
            region: string
            skipTlsVerify: boolean
            timeout: number
        }
        webdav: {
            endpoint: string
            username: string
            password: string
            skipTlsVerify: boolean
            timeout: number
        }
    },
    lang: string
    api: {
        token: string
    }
    openHelp: boolean
    system: {
        lockScreenMode: number   // 0：手动，1：手动+跟随系统
        networkProxy: {
            host: string
            port: string
            scheme: string
        }
        name: string
        kernelVersion: string
        isInsider: boolean
        appDir: string
        workspaceDir: string
        confDir: string
        dataDir: string
        container: "std" | "android" | "docker" | "ios"
        isMicrosoftStore: boolean
        os: "windows" | "linux" | "darwin"
        osPlatform: string
        homeDir: string
        xanadu: boolean
        udanax: boolean
        uploadErrLog: boolean
        disableGoogleAnalytics: boolean
        downloadInstallPkg: boolean
        networkServe: boolean
        fixedPort: boolean
        autoLaunch: boolean
    }
    localIPs: string[]
    readonly: boolean   // 全局只读
    uiLayout: Record<string, any>
    langs: { label: string, name: string }[]
    appearance: IAppearance
    editor: IEditor,
    fileTree: IFileTree
    graph: IGraph
    keymap: IKeymap
    export: IExport
    accessAuthCode: string
    account: IAccount
    tag: {
        sort: number
    }
    search: {
        embedBlock: boolean
        htmlBlock: boolean
        document: boolean
        heading: boolean
        list: boolean
        listItem: boolean
        codeBlock: boolean
        mathBlock: boolean
        table: boolean
        blockquote: boolean
        superBlock: boolean
        paragraph: boolean
        name: boolean
        alias: boolean
        memo: boolean
        indexAssetPath: boolean
        ial: boolean
        limit: number
        caseSensitive: boolean
        backlinkMentionName: boolean
        backlinkMentionAlias: boolean
        backlinkMentionAnchor: boolean
        backlinkMentionDoc: boolean
        backlinkMentionKeywordsLimit: boolean
        virtualRefName: boolean
        virtualRefAlias: boolean
        virtualRefAnchor: boolean
        virtualRefDoc: boolean
    },
    stat: {
        treeCount: number
        cTreeCount: number
        blockCount: number
        cBlockCount: number
        dataSize: number
        cDataSize: number
        assetsSize: number
        cAssetsSize: number
    }
}

interface IGraphCommon {
    d3: {
        centerStrength: number
        collideRadius: number
        collideStrength: number
        lineOpacity: number
        linkDistance: number
        linkWidth: number
        nodeSize: number
        arrow: boolean
    }
    type: {
        blockquote: boolean
        code: boolean
        heading: boolean
        list: boolean
        listItem: boolean
        math: boolean
        paragraph: boolean
        super: boolean
        table: boolean
        tag: boolean
    }
}

interface IGraph {
    global: {
        minRefs: number
        dailyNote: boolean
    } & IGraphCommon
    local: {
        dailyNote: boolean
    } & IGraphCommon
}

interface IKeymap {
    plugin: {
        [key: string]: {
            [key: string]: IKeymapItem
        }
    }
    general: { [key: string]: IKeymapItem }
    editor: {
        general: { [key: string]: IKeymapItem }
        insert: { [key: string]: IKeymapItem }
        heading: { [key: string]: IKeymapItem }
        list: { [key: string]: IKeymapItem }
        table: { [key: string]: IKeymapItem }
    }
}

interface IKeymapItem {
    default: string,
    custom: string
}

interface IFile {
    icon: string;
    name1: string;
    alias: string;
    memo: string;
    bookmark: string;
    path: string;
    name: string;
    hMtime: string;
    hCtime: string;
    hSize: string;
    dueFlashcardCount?: string;
    newFlashcardCount?: string;
    flashcardCount?: string;
    id: string;
    count: number;
    subFileCount: number;
}

interface IBlockTree {
    box: string,
    nodeType: string,
    hPath: string,
    subType: string,
    name: string,
    type: string,
    depth: number,
    url?: string,
    label?: string,
    id?: string,
    blocks?: IBlock[],
    count: number,
    children?: IBlockTree[]
}

interface IBlock {
    riffCardReps?: number   // 闪卡复习次数
    depth?: number,
    box?: string;
    path?: string;
    hPath?: string;
    id?: string;
    rootID?: string;
    type?: string;
    content?: string;
    def?: IBlock;
    defID?: string
    defPath?: string
    refText?: string;
    name?: string;
    memo?: string;
    alias?: string;
    refs?: IBlock[];
    children?: IBlock[]
    length?: number
    ial: IObject
}

interface IModels {
    editor: import("../editor").Editor [],
    graph: import("../layout/dock/Graph").Graph[],
    outline: import("../layout/dock/Outline").Outline[]
    backlink: import("../layout/dock/Backlink").Backlink[]
    inbox: import("../layout/dock/Inbox").Inbox[]
    files: import("../layout/dock/Files").Files[]
    bookmark: import("../layout/dock/Bookmark").Bookmark[]
    tag: import("../layout/dock/Tag").Tag[]
    asset: import("../asset").Asset[]
    search: import("../search").Search[]
    custom: import("../layout/dock/Custom").Custom[]
}

interface IMenu {
    label?: string,
    click?: (element: HTMLElement, event: MouseEvent) => boolean | void | Promise<boolean | void>
    type?: "separator" | "submenu" | "readonly",
    accelerator?: string,
    action?: string,
    id?: string,
    submenu?: IMenu[]
    disabled?: boolean
    icon?: string
    iconHTML?: string
    current?: boolean
    bind?: (element: HTMLElement) => void
    index?: number
    element?: HTMLElement
}

interface IBazaarItem {
    incompatible?: boolean  // 仅 plugin
    enabled: boolean
    preferredName: string
    preferredDesc: string
    preferredReadme: string
    iconURL: string
    stars: string
    author: string
    updated: string
    downloads: string
    current: false
    installed: false
    outdated: false
    name: string
    previewURL: string
    previewURLThumb: string
    repoHash: string
    repoURL: string
    url: string
    openIssues: number
    version: string
    modes: string[]
    hSize: string
    hInstallSize: string
    hInstallDate: string
    hUpdated: string
    preferredFunding: string
}

interface IAV {
    id: string
    name: string
    view: IAVTable
    viewID: string
    viewType: string
    views: IAVView[]
}

interface IAVView {
    name: string
    id: string
    type: string
}

interface IAVTable {
    columns: IAVColumn[],
    filters: IAVFilter[],
    sorts: IAVSort[],
    name: string,
    type: "table"
    rows: IAVRow[],
    id: string
}

interface IAVFilter {
    column: string,
    operator: TAVFilterOperator,
    value: IAVCellValue
}

interface IAVSort {
    column: string,
    order: "ASC" | "DESC"
}

interface IAVColumn {
    width: number,
    icon: string,
    id: string,
    name: string,
    wrap: boolean,
    hidden: boolean,
    type: TAVCol,
    numberFormat: string,
    calc: {
        operator: string,
        result: IAVCellValue
    },
    // 选项列表
    options?: {
        name: string,
        color: string,
    }[]
}

interface IAVRow {
    id: string,
    cells: IAVCell[]
}

interface IAVCell {
    id: string,
    color: string,
    bgColor: string,
    value: IAVCellValue,
    valueType: TAVCol,
}

interface IAVCellValue {
    type?: TAVCol,
    text?: { content: string },
    number?: { content?: number, isNotEmpty: boolean, format?: string, formattedContent?: string },
    mSelect?: { content: string, color: string }[]
    block?: { content: string, id?: string }
    url?: { content: string }
    phone?: { content: string }
    email?: { content: string }
    date?: IAVCellDateValue
}

interface IAVCellDateValue {
    content?: number,
    isNotEmpty?: boolean
    content2?: number,
    isNotEmpty2?: boolean
    hasEndDate?: boolean
}
