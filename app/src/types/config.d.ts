/**
 * Copyright (C) 2023 SiYuan Community
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

declare namespace Config {

    /**
     * Configuration object
     */
    export interface IConf {
        /**
         * Access authorization code
         */
        accessAuthCode: TAccessAuthCode;
        account: IAccount;
        ai: IAI;
        api: IAPI;
        appearance: IAppearance;
        bazaar: IBazaar;
        /**
         * Cloud Service Provider Region
         * - `0`: Chinese mainland
         * - `1`: North America
         */
        cloudRegion: number;
        editor: IEditor;
        export: IExport;
        fileTree: IFileTree;
        flashcard: IFlashCard;
        graph: IGraph;
        keymap: IKeymap;
        /**
         * User interface language
         * Same as {@link IAppearance.lang}
         */
        lang: TLang;
        /**
         * List of supported languages
         */
        langs: ILang[];
        /**
         * A list of the IP addresses of the devices on which the kernel resides
         */
        localIPs: string[];
        /**
         * Log level
         */
        logLevel: TLogLevel;
        /**
         * Whether to open the user guide after startup
         */
        openHelp: boolean;
        /**
         * Publishing service
         * 发布服务
         */
        publish: IPublish;
        /**
         * Whether it is running in read-only mode
         * 全局只读
         */
        readonly: boolean;
        repo: IRepo;
        search: ISearch;
        /**
         * Whether to display the changelog for this release version
         */
        showChangelog: boolean;
        snippet: ISnippet;
        stat: IStat;
        sync: ISync;
        system: ISystem;
        tag: ITag;
        uiLayout: IUiLayout;
        /**
         * Community user data (Encrypted)
         */
        userData: string;
    }

    /**
     * Access authorization code
     */
    export type TAccessAuthCode = "" | "*******";

    /**
     * Account configuration
     */
    export interface IAccount {
        /**
         * Display the title icon
         */
        displayTitle: boolean;
        /**
         * Display the VIP icon
         */
        displayVIP: boolean;
    }

    /**
     * Artificial Intelligence (AI) related configuration
     */
    export interface IAI {
        openAI: IOpenAI;
    }

    /**
     * Open AI related configuration
     */
    export interface IOpenAI {
        /**
         * API base URL
         */
        apiBaseURL: string;
        /**
         * API key
         */
        apiKey: string;
        /**
         * The maximum number of contexts passed when requesting the API
         */
        apiMaxContexts: number;
        /**
         * Maximum number of tokens (0 means no limit)
         */
        apiMaxTokens: number;
        /**
         * The model name called by the API
         */
        apiModel: TOpenAIAPIModel;
        /**
         * API Provider
         * OpenAI, Azure
         */
        apiProvider: TOpenAAPIProvider;
        /**
         * API request proxy address
         */
        apiProxy: string;
        /**
         * Parameter `temperature` that controls the randomness of the generated text
         */
        apiTemperature: number;
        /**
         * API request timeout (unit: seconds)
         */
        apiTimeout: number;
        /**
         * API request additional user agent field
         */
        apiUserAgent: string;
        /**
         * API version number
         */
        apiVersion: string;
    }

    /**
     * The model name called by the API
     */
    export type TOpenAIAPIModel = "gpt-4" | "gpt-4-32k" | "gpt-3.5-turbo" | "gpt-3.5-turbo-16k";

    /**
     * API Provider
     */
    export type TOpenAAPIProvider = "OpenAI" | "Azure";

    /**
     * SiYuan API related configuration
     */
    export interface IAPI {
        /**
         * API Token
         */
        token: string;
    }

    /**
     * SiYuan appearance related configuration
     */
    export interface IAppearance {
        /**
         * Close button behavior
         * - `0`: Exit application
         * - `1`: Minimize to pallets
         */
        closeButtonBehavior: number;
        /**
         * Dark code block theme
         */
        codeBlockThemeDark: string;
        /**
         * Light code block theme
         */
        codeBlockThemeLight: string;
        /**
         * List of installed dark themes
         */
        darkThemes: string[];
        /**
         * Whether to hide status bar
         */
        hideStatusBar: boolean;
        /**
         * The name of the icon currently in use
         */
        icon: string;
        /**
         * List of installed icon names
         */
        icons: string[];
        /**
         * The version number of the icon currently in use
         */
        iconVer: string;
        /**
         * The language used by the current user
         */
        lang: TLang;
        /**
         * List of installed light themes
         */
        lightThemes: string[];
        /**
         * The current theme mode
         * - `0`: Light theme
         * - `1`: Dark theme
         */
        mode: number;
        /**
         * Whether the theme mode follows the system theme
         */
        modeOS: boolean;
        /**
         * The name of the dark theme currently in use
         */
        themeDark: string;
        /**
         * Whether the current theme has enabled theme JavaScript
         */
        themeJS: boolean;
        /**
         * The name of the light theme currently in use
         */
        themeLight: string;
        /**
         * The version number of the theme currently in use
         */
        themeVer: string;
    }

    /**
     * The language used by the current user
     *
     * User interface language
     * Same as {@link IAppearance.lang}
     */
    export type TLang = "en_US" | "es_ES" | "fr_FR" | "zh_CHT" | "zh_CN" | "ja_JP";

    /**
     * SiYuan bazaar related configuration
     */
    export interface IBazaar {
        /**
         * Whether to disable all plug-ins
         */
        petalDisabled: boolean;
        /**
         * Whether to trust (enable) the resources for the bazaar
         */
        trust: boolean;
    }

    /**
     * SiYuan editor markdown related configuration
     */
    interface IMarkdown {
        /**
         * Whether to enable the inline superscript
         */
        inlineSup: boolean;
        /**
         * Whether to enable the inline subscript
         */
        inlineSub: boolean;
        /**
         * Whether to enable the inline tag
         */
        inlineTag: boolean;
        /**
         * Whether to enable the inline math
         */
        inlineMath: boolean;
    }

    /**
     * SiYuan editor related configuration
     */
    export interface IEditor {

        /**
         * Whether to allow to execute javascript in the HTML block
         */
        allowHTMLBLockScript: boolean;

        /**
         * Markdown configuration
         */
        markdown: IMarkdown;

        /**
         * The default number of backlinks to expand
         */
        backlinkExpandCount: number;
        /**
         * The default number of backlinks to mention
         */
        backmentionExpandCount: number;
        /**
         * The maximum length of the dynamic anchor text for block references
         */
        blockRefDynamicAnchorTextMaxLen: number;
        /**
         * Whether the code block has enabled ligatures
         */
        codeLigatures: boolean;
        /**
         * Whether the code block is automatically wrapped
         */
        codeLineWrap: boolean;
        /**
         * Whether the code block displays line numbers
         */
        codeSyntaxHighlightLineNum: boolean;
        /**
         * The number of spaces generated by the Tab key in the code block, configured as 0 means no
         * conversion to spaces
         */
        codeTabSpaces: number;
        /**
         * Whether to display the bookmark icon
         */
        displayBookmarkIcon: boolean;
        /**
         * Whether to display the network image mark
         */
        displayNetImgMark: boolean;
        /**
         * The number of blocks loaded each time they are dynamically loaded
         */
        dynamicLoadBlocks: number;
        /**
         * Whether the embedded block displays breadcrumbs
         */
        embedBlockBreadcrumb: boolean;
        /**
         * Common emoji icons
         */
        emoji: string[];
        /**
         * The trigger mode of the preview window
         * - `0`: Hover over the cursor
         * - `1`: Hover over the cursor while holding down Ctrl
         * - `2`: Do not trigger the floating window
         */
        floatWindowMode: number;
        /**
         * The font used in the editor
         */
        fontFamily: string;
        /**
         * The font size used in the editor
         */
        fontSize: number;
        /**
         * Whether to enable the use of the mouse wheel to adjust the font size of the editor
         */
        fontSizeScrollZoom: boolean;
        /**
         * Whether the editor uses maximum width
         */
        fullWidth: boolean;
        /**
         * The time interval for generating document history, set to 0 to disable document history
         * (unit: minutes)
         */
        generateHistoryInterval: number;
        /**
         * History retention days
         */
        historyRetentionDays: number;
        /**
         * Whether to enable text justification
         */
        justify: boolean;
        /**
         * KeTex macro definition (JSON string)
         */
        katexMacros: string;
        /**
         * Whether to enable single-click list item mark focus
         */
        listItemDotNumberClickFocus: boolean;
        /**
         * Whether to enable the list logical reverse indentation scheme
         */
        listLogicalOutdent: boolean;
        /**
         * Whether to enable the `[[` symbol to search only for document blocks
         */
        onlySearchForDoc: boolean;
        /**
         * PlantUML rendering service address
         */
        plantUMLServePath: string;
        /**
         * Whether to enable read-only mode
         */
        readOnly: boolean;
        /**
         * Whether to enable RTL (left-to-right chirography) mode
         */
        rtl: boolean;
        /**
         * Whether to enable spell checking
         */
        spellcheck: boolean;
        /**
         * Whether to enable virtual references
         */
        virtualBlockRef: boolean;
        /**
         * Virtual reference keyword exclusion list (separated by commas `,`)
         */
        virtualBlockRefExclude: string;
        /**
         * Virtual reference keyword inclusion list (separated by commas `,`)
         */
        virtualBlockRefInclude: string;
    }

    /**
     * SiYuan export related configuration
     */
    export interface IExport {
        /**
         * Add article title (insert the article title as a first-level title at the beginning of
         * the document)
         */
        addTitle: boolean;
        /**
         * Embedded block export mode
         * - `0`: Original block content
         * - `1`: Quotation block
         */
        blockEmbedMode: number;
        /**
         * Content block reference export mode
         * - `0`: Original text (deprecated)
         * - `1`: Quotation block (deprecated)
         * - `2`: Anchor text block link
         * - `3`: Anchor text only
         * - `4`: Footnote
         * - `5`: Anchor hash
         */
        blockRefMode: number;
        /**
         * The symbol on the left side of the block reference anchor text during export
         */
        blockRefTextLeft: string;
        /**
         * The symbol on the right side of the block reference anchor text during export
         */
        blockRefTextRight: string;
        /**
         * The path of the template file used when exporting to Docx
         */
        docxTemplate: string;
        /**
         * File annotation reference export mode
         * - `0`: File name - page number - anchor text
         * - `1`: Anchor text only
         */
        fileAnnotationRefMode: number;
        /**
         * Custom watermark position, size, style, etc. when exporting to an image
         */
        imageWatermarkDesc: string;
        /**
         * The watermark text or watermark file path used when exporting to an image
         */
        imageWatermarkStr: string;
        /**
         * Whether to add YAML Front Matter when exporting to Markdown
         */
        markdownYFM: boolean;
        /**
         * Pandoc executable file path
         */
        pandocBin: string;
        /**
         * Whether the beginning of the paragraph is empty two spaces.
         * Insert two full-width spaces `U+3000` at the beginning of the paragraph.
         */
        paragraphBeginningSpace: boolean;
        /**
         * Custom footer content when exporting to PDF
         */
        pdfFooter: string;
        /**
         * Custom watermark position, size, style, etc. when exporting to PDF
         */
        pdfWatermarkDesc: string;
        /**
         * The watermark text or watermark file path used when exporting to PDF
         */
        pdfWatermarkStr: string;
        /**
         * Tag close marker symbol
         */
        tagCloseMarker: string;
        /**
         * Tag start marker symbol
         */
        tagOpenMarker: string;
    }

    /**
     * Document tree related configuration
     */
    export interface IFileTree {
        /**
         * Whether to allow the creation of sub-documents deeper than 7 levels
         */
        allowCreateDeeper: boolean;
        /**
         * Whether to automatically locate the currently open document in the document tree
         */
        alwaysSelectOpenedFile: boolean;
        /**
         * Whether to close all tabs when starting
         */
        closeTabsOnStart: boolean;
        /**
         * The storage path of the new document
         */
        docCreateSavePath: string;
        /**
         * The maximum number of documents listed
         */
        maxListCount: number;
        /**
         * The maximum number of open tabs
         */
        maxOpenTabCount: number;
        /**
         * Whether to open the file in the current tab
         */
        openFilesUseCurrentTab: boolean;
        /**
         * The storage path of the new document created using block references
         */
        refCreateSavePath: string;
        refCreateSaveBox: string;
        docCreateSaveBox: string;
        /**
         * Close the secondary confirmation when deleting a document
         */
        removeDocWithoutConfirm: boolean;
        /**
         * Document sorting method
         * - `0`: File name ascending
         * - `1`: File name descending
         * - `2`: File update time ascending
         * - `3`: File update time descending
         * - `4`: File name natural number ascending
         * - `5`: File name natural number descending
         * - `6`: Custom sorting
         * - `7`: Reference count ascending
         * - `8`: Reference count descending
         * - `9`: File creation time ascending
         * - `10`: File creation time descending
         * - `11`: File size ascending
         * - `12`: File size descending
         * - `13`: Sub-document count ascending
         * - `14`: Sub-document count descending
         * - `15`: Use document tree sorting rules
         * - `256`: Unspecified sorting rules, according to the notebook priority over the document
         * tree to obtain sorting rules
         */
        sort: number;
        /**
         * Whether to save the content of the .sy file as a single-line JSON object
         */
        useSingleLineSave: boolean;
    }

    /**
     * Flashcard related configuration
     */
    export interface IFlashCard {
        /**
         * Whether to enable deck card making
         */
        deck: boolean;
        /**
         * Whether to enable heading block card making
         */
        heading: boolean;
        /**
         * Whether to enable list block card making
         */
        list: boolean;
        /**
         * Whether to enable mark element card making
         */
        mark: boolean;
        /**
         * Maximum interval days
         */
        maximumInterval: number;
        /**
         * New card limit
         */
        newCardLimit: number;
        /**
         * FSRS request retention parameter
         */
        requestRetention: number;
        /**
         * Review card limit
         */
        reviewCardLimit: number;
        /**
         * Review mode
         * - `0`: New and old mixed
         * - `1`: New card priority
         * - `2`: Old card priority
         */
        reviewMode: number;
        /**
         * Whether to enable super block card making
         */
        superBlock: boolean;
        /**
         * FSRS weight parameter list
         */
        weights: string;
    }

    /**
     * SiYuan graph related configuration
     */
    export interface IGraph {
        global: IGraphGlobal;
        local: IGraphLocal;
        /**
         * Maximum number of content blocks displayed
         */
        maxBlocks: number;
    }

    /**
     * Global graph configuration
     */
    export interface IGraphGlobal {
        d3: IGraphD3;
        /**
         * Whether to display nodes in daily notes
         */
        dailyNote: boolean;
        /**
         * The minimum number of references to the displayed node
         */
        minRefs: number;
        type: IGraphType;
    }

    /**
     * d3.js graph configuration
     */
    export interface IGraphD3 {
        /**
         * Whether to display the arrow
         */
        arrow: boolean;
        /**
         * Central gravity intensity
         */
        centerStrength: number;
        /**
         * Repulsion radius
         */
        collideRadius: number;
        /**
         * Repulsion intensity
         */
        collideStrength: number;
        /**
         * Line opacity
         */
        lineOpacity: number;
        /**
         * Link distance
         */
        linkDistance: number;
        /**
         * Line width
         */
        linkWidth: number;
        /**
         * Node size
         */
        nodeSize: number;
    }

    /**
     * SiYuan node type filter
     */
    export interface IGraphType {
        /**
         * Display quote block
         */
        blockquote: boolean;
        /**
         * Display code block
         */
        code: boolean;
        /**
         * Display heading block
         */
        heading: boolean;
        /**
         * Display list block
         */
        list: boolean;
        /**
         * Display list item
         */
        listItem: boolean;
        /**
         * Display formula block
         */
        math: boolean;
        /**
         * Display paragraph block
         */
        paragraph: boolean;
        /**
         * Display super block
         */
        super: boolean;
        /**
         * Display table block
         */
        table: boolean;
        /**
         * Display tag
         */
        tag: boolean;
    }

    /**
     * Local graph configuration
     */
    export interface IGraphLocal {
        d3: IGraphD3;
        /**
         * Whether to display nodes in daily notes
         */
        dailyNote: boolean;
        type: IGraphType;
    }

    /**
     * SiYuan keymap related configuration
     */
    export interface IKeymap {
        editor: IKeymapEditor;
        general: IKeymapGeneral;
        plugin: IKeymapPlugin;
    }

    /**
     * SiYuan editor shortcut keys
     */
    export interface IKeymapEditor {
        general: IKeymapEditorGeneral;
        heading: IKeymapEditorHeading;
        insert: IKeymapEditorInsert;
        list: IKeymapEditorList;
        table: IKeymapEditorTable;
    }

    /**
     * SiYuan editor general shortcut keys
     */
    export interface IKeymapEditorGeneral extends IKeys {
        ai: IKey;
        alignCenter: IKey;
        alignLeft: IKey;
        alignRight: IKey;
        attr: IKey;
        backlinks: IKey;
        collapse: IKey;
        copyBlockEmbed: IKey;
        copyBlockRef: IKey;
        copyHPath: IKey;
        copyID: IKey;
        copyPlainText: IKey;
        copyProtocol: IKey;
        copyProtocolInMd: IKey;
        copyText: IKey;
        duplicate: IKey;
        exitFocus: IKey;
        expand: IKey;
        expandDown: IKey;
        expandUp: IKey;
        fullscreen: IKey;
        graphView: IKey;
        hLayout: IKey;
        insertAfter: IKey;
        insertBefore: IKey;
        insertBottom: IKey;
        insertRight: IKey;
        jumpToParentNext: IKey;
        moveToDown: IKey;
        moveToUp: IKey;
        netAssets2LocalAssets: IKey;
        netImg2LocalAsset: IKey;
        newContentFile: IKey;
        newNameFile: IKey;
        newNameSettingFile: IKey;
        openBy: IKey;
        optimizeTypography: IKey;
        outline: IKey;
        preview: IKey;
        quickMakeCard: IKey;
        redo: IKey;
        refPopover: IKey;
        refresh: IKey;
        refTab: IKey;
        rename: IKey;
        showInFolder: IKey;
        spaceRepetition: IKey;
        switchReadonly: IKey;
        undo: IKey;
        vLayout: IKey;
        wysiwyg: IKey;
    }

    /**
     * SiYuan shortcut keys
     */
    export interface IKeys {
        [key: string]: IKey;
    }

    /**
     * SiYuan shortcut key
     */
    export interface IKey {
        /**
         * Custom shortcut key
         */
        custom: string;
        /**
         * Default shortcut key
         */
        default: string;
    }

    /**
     * SiYuan editor heading shortcut keys
     */
    export interface IKeymapEditorHeading extends IKeys {
        heading1: IKey;
        heading2: IKey;
        heading3: IKey;
        heading4: IKey;
        heading5: IKey;
        heading6: IKey;
        paragraph: IKey;
    }

    /**
     * SiYuan editor insert shortcut keys
     */
    export interface IKeymapEditorInsert extends IKeys {
        appearance: IKey;
        bold: IKey;
        check: IKey;
        clearInline: IKey;
        code: IKey;
        "inline-code": IKey;
        "inline-math": IKey;
        italic: IKey;
        kbd: IKey;
        lastUsed: IKey;
        link: IKey;
        mark: IKey;
        memo: IKey;
        ref: IKey;
        strike: IKey;
        sub: IKey;
        sup: IKey;
        table: IKey;
        tag: IKey;
        underline: IKey;
    }

    /**
     * SiYuan editor list shortcut keys
     */
    export interface IKeymapEditorList extends IKeys {
        checkToggle: IKey;
        indent: IKey;
        outdent: IKey;
    }

    /**
     * SiYuan editor table shortcut keys
     */
    export interface IKeymapEditorTable extends IKeys {
        "delete-column": IKey;
        "delete-row": IKey;
        insertColumnLeft: IKey;
        insertColumnRight: IKey;
        insertRowAbove: IKey;
        insertRowBelow: IKey;
        moveToDown: IKey;
        moveToLeft: IKey;
        moveToRight: IKey;
        moveToUp: IKey;
    }

    /**
     * SiYuan general shortcut keys
     */
    export interface IKeymapGeneral extends IKeys {
        addToDatabase: IKey;
        backlinks: IKey;
        bookmark: IKey;
        closeAll: IKey;
        closeLeft: IKey;
        closeOthers: IKey;
        closeRight: IKey;
        closeTab: IKey;
        closeUnmodified: IKey;
        commandPanel: IKey;
        config: IKey;
        dailyNote: IKey;
        dataHistory: IKey;
        editReadonly: IKey;
        enter: IKey;
        enterBack: IKey;
        fileTree: IKey;
        globalGraph: IKey;
        globalSearch: IKey;
        goBack: IKey;
        goForward: IKey;
        goToEditTabNext: IKey;
        goToEditTabPrev: IKey;
        goToTab1: IKey;
        goToTab2: IKey;
        goToTab3: IKey;
        goToTab4: IKey;
        goToTab5: IKey;
        goToTab6: IKey;
        goToTab7: IKey;
        goToTab8: IKey;
        goToTab9: IKey;
        goToTabNext: IKey;
        goToTabPrev: IKey;
        graphView: IKey;
        inbox: IKey;
        lockScreen: IKey;
        mainMenu: IKey;
        move: IKey;
        newFile: IKey;
        outline: IKey;
        recentDocs: IKey;
        replace: IKey;
        riffCard: IKey;
        search: IKey;
        selectOpen1: IKey;
        splitLR: IKey;
        splitMoveB: IKey;
        splitMoveR: IKey;
        splitTB: IKey;
        stickSearch: IKey;
        syncNow: IKey;
        tabToWindow: IKey;
        tag: IKey;
        toggleDock: IKey;
        toggleWin: IKey;
    }

    /**
     * SiYuan plugin shortcut keys
     */
    export interface IKeymapPlugin {
        [key: string]: IKeys;
    }

    /**
     * Supported language
     */
    export interface ILang {
        /**
         * Language name
         */
        label: string;
        /**
         * Language identifier
         */
        name: string;
    }

    /**
     * Log level
     */
    export type TLogLevel = "off" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";

    /**
     * Publishing service
     */
    export interface IPublish {
        /**
         * Whether to open the publishing service
         */
        enable: boolean;
        /**
         * The basic authentication settings of publishing service
         */
        auth: IPublishAuth;
        /**
         * Port on which the publishing service listens
         */
        port: number;
    }

    /**
     * Publishing service authentication settings
     */
    export interface IPublishAuth {
        /**
         * Whether to enable basic authentication for publishing services
         */
        enable: boolean;
        /**
         * List of basic verified accounts
         */
        accounts: IPublishAuthAccount[];
    }

    /**
     * Basic authentication account
     */
    export interface IPublishAuthAccount {
        /**
         * Account username
         */
        username: string;
        /**
         * Account password
         */
        password: string;
        /**
         * The memo text of the account
         */
        memo: string;
    }

    /**
     * Snapshot repository related configuration
     */
    export interface IRepo {
        /**
         * Snapshot encryption key (base64 encoded 256-bit key)
         */
        key: string;
        /**
         * Synchronous index timing, if it exceeds this time, the user is prompted that the index
         * performance is degraded (unit: milliseconds)
         */
        syncIndexTiming: number;
    }

    /**
     * SiYuan search related configuration
     */
    export interface ISearch {
        /**
         * Whether to search in block aliases
         */
        alias: boolean;
        /**
         * Whether to search in audio blocks
         */
        audioBlock: boolean;
        /**
         * Extract backlink mention keywords from block aliases
         */
        backlinkMentionAlias: boolean;
        /**
         * Extract backlink mention keywords from block reference anchor text
         */
        backlinkMentionAnchor: boolean;
        /**
         * Extract backlink mention keywords from document names
         */
        backlinkMentionDoc: boolean;
        /**
         * Maximum number of backlink mention keywords
         */
        backlinkMentionKeywordsLimit: number;
        /**
         * Extract backlink mention keywords from block names
         */
        backlinkMentionName: boolean;
        /**
         * Whether to search quote blocks
         */
        blockquote: boolean;
        /**
         * Whether to distinguish between uppercase and lowercase letters when searching
         */
        caseSensitive: boolean;
        /**
         * Whether to search code blocks
         */
        codeBlock: boolean;
        /**
         * Whether to search database blocks
         */
        databaseBlock: boolean;
        /**
         * Whether to search document blocks
         */
        document: boolean;
        /**
         * Whether to search embedded blocks
         */
        embedBlock: boolean;
        /**
         * Whether to search heading blocks
         */
        heading: boolean;
        /**
         * Whether to search HTML blocks
         */
        htmlBlock: boolean;
        /**
         * Whether to search block attributes
         */
        ial: boolean;
        /**
         * Whether to search in iframe blocks
         */
        iframeBlock: boolean;
        /**
         * Whether to search resource file paths
         */
        indexAssetPath: boolean;
        /**
         * Number of search results displayed
         */
        limit: number;
        /**
         * Whether to search list blocks
         */
        list: boolean;
        /**
         * Whether to search list items
         */
        listItem: boolean;
        /**
         * Whether to search formula blocks
         */
        mathBlock: boolean;
        /**
         * Whether to search block notes
         */
        memo: boolean;
        /**
         * Whether to search block names
         */
        name: boolean;
        /**
         * Whether to search paragraph blocks
         */
        paragraph: boolean;
        /**
         * Whether to search super blocks
         */
        superBlock: boolean;
        /**
         * Whether to search table blocks
         */
        table: boolean;
        /**
         * Whether to search in video blocks
         */
        videoBlock: boolean;
        /**
         * Whether to get virtual reference keywords from block aliases
         */
        virtualRefAlias: boolean;
        /**
         * Whether to get virtual reference keywords from block reference anchor text
         */
        virtualRefAnchor: boolean;
        /**
         * Whether to get virtual reference keywords from document names
         */
        virtualRefDoc: boolean;
        /**
         * Whether to get virtual reference keywords from block names
         */
        virtualRefName: boolean;
        /**
         * Whether to search in widget blocks
         */
        widgetBlock: boolean;
    }

    /**
     * SiYuan code snippets related configuration
     */
    export interface ISnippet {
        /**
         * Whether to enable CSS code snippets
         */
        enabledCSS: boolean;
        /**
         * Whether to enable JavaScript code snippets
         */
        enabledJS: boolean;
    }

    /**
     * SiYuan workspace content statistics
     */
    export interface IStat {
        /**
         * Asset file size (unit: bytes)
         */
        assetsSize: number;
        /**
         * Number of content blocks
         */
        blockCount: number;
        /**
         * Size of resource files after chunk encryption (unit: bytes)
         */
        cAssetsSize: number;
        /**
         * Number of content blocks after chunk encryption
         */
        cBlockCount: number;
        /**
         * Size of the data directory after chunk encryption (unit: bytes)
         */
        cDataSize: number;
        /**
         * Number of content block trees after chunk encryption (number of documents)
         */
        cTreeCount: number;
        /**
         * Data directory size (unit: bytes)
         */
        dataSize: number;
        /**
         * Number of content block trees (number of documents)
         */
        treeCount: number;
    }

    /**
     * SiYuan synchronization related configuration
     */
    export interface ISync {
        /**
         * Cloud workspace name
         */
        cloudName: string;
        /**
         * Whether to enable synchronization
         */
        enabled: boolean;
        /**
         * Whether to create a conflict document when a conflict occurs during synchronization
         */
        generateConflictDoc: boolean;
        /**
         * Synchronization mode
         * - `0`: Not set
         * - `1`: Automatic synchronization
         * - `2`: Manual synchronization
         * - `3`: Completely manual synchronization
         */
        mode: number;
        /**
         * Whether to enable synchronization perception
         */
        perception: boolean;
        /**
         * Cloud storage service provider
         * - `0`: SiYuan official cloud storage service
         * - `2`: Object storage service compatible with S3 protocol
         * - `3`: Network storage service using WebDAV protocol
         */
        provider: number;
        s3: ISyncS3;
        /**
         * The prompt information of the last synchronization
         */
        stat: string;
        /**
         * The time of the last synchronization (Unix timestamp)
         */
        synced: number;
        webdav: ISyncWebDAV;
    }

    /**
     * S3 compatible object storage related configuration
     */
    export interface ISyncS3 {
        /**
         * Access key
         */
        accessKey: string;
        /**
         * Bucket name
         */
        bucket: string;
        /**
         * Service endpoint address
         */
        endpoint: string;
        /**
         * Whether to use path-style URLs
         */
        pathStyle: boolean;
        /**
         * Storage region
         */
        region: string;
        /**
         * Security key
         */
        secretKey: string;
        /**
         * Whether to skip TLS verification
         */
        skipTlsVerify: boolean;
        /**
         * Timeout (unit: seconds)
         */
        timeout: number;
    }

    /**
     * WebDAV related configuration
     */
    export interface ISyncWebDAV {
        /**
         * Service endpoint
         */
        endpoint: string;
        /**
         * Password
         */
        password: string;
        /**
         * Whether to skip TLS verification
         */
        skipTlsVerify: boolean;
        /**
         * Timeout (unit: seconds)
         */
        timeout: number;
        /**
         * Username
         */
        username: string;
    }

    /**
     * System related information
     */
    export interface ISystem {
        /**
         * The absolute path of the `resources` directory under the SiYuan installation directory
         */
        appDir: string;
        /**
         * Boot automatically
         * - `0`: Do not boot automatically
         * - `1`: Boot automatically
         * - `2`: Boot automatically + Minimize UI
         */
        autoLaunch2: number;
        /**
         * The absolute path of the `conf` directory of the current workspace
         */
        confDir: string;
        /**
         * Kernel operating environment
         * - `docker`: Docker container
         * - `android`: Android device
         * - `ios`: iOS device
         * - `std`: Desktop Electron environment
         */
        container: TSystemContainer;
        /**
         * The absolute path of the `data` directory of the current workspace
         */
        dataDir: string;
        /**
         * Whether to disable Google Analytics
         */
        disableGoogleAnalytics: boolean;
        /**
         * Whether to automatically download the installation package for the new version
         */
        downloadInstallPkg: boolean;
        /**
         * The absolute path of the user's home directory for the current operating system user
         */
        homeDir: string;
        /**
         * The UUID of the current session
         */
        id: string;
        /**
         * Whether the current version is an internal test version
         */
        isInsider: boolean;
        /**
         * Whether the current version is a Microsoft Store version
         */
        isMicrosoftStore: boolean;
        /**
         * Kernel version number
         */
        kernelVersion: string;
        /**
         * Lock screen mode
         * - `0`: Manual
         * - `1`: Manual + Follow the operating system
         */
        lockScreenMode: number;
        /**
         * The name of the current device
         */
        name: string;
        networkProxy: INetworkProxy;
        /**
         * Whether to enable network serve (whether to allow connections from other devices)
         */
        networkServe: boolean;
        /**
         * The operating system name determined at compile time (obtained using the command `go tool
         * dist list`)
         * - `android`: Android
         * - `darwin`: macOS
         * - `ios`: iOS
         * - `linux`: Linux
         * - `windows`: Windows
         */
        os: TSystemOS;
        /**
         * Operating system platform name
         */
        osPlatform: string;
        /**
         * Whether to upload error logs
         */
        uploadErrLog: boolean;
        /**
         * The absolute path of the workspace directory
         */
        workspaceDir: string;
    }

    /**
     * Kernel operating environment
     * - `docker`: Docker container
     * - `android`: Android device
     * - `ios`: iOS device
     * - `std`: Desktop Electron environment
     */
    export type TSystemContainer = "docker" | "android" | "ios" | "std";

    /**
     * SiYuan Network proxy configuration
     */
    export interface INetworkProxy {
        /**
         * Host name or host address
         */
        host: string;
        /**
         * Proxy server port number
         */
        port: string;
        /**
         * The protocol used by the proxy server
         * - Empty String: Use the system proxy settings
         * - `http`: HTTP
         * - `https`: HTTPS
         * - `socks5`: SOCKS5
         */
        scheme: TSystemNetworkProxyScheme;
    }

    /**
     * The protocol used by the proxy server
     * - Empty String: Use the system proxy settings
     * - `http`: HTTP
     * - `https`: HTTPS
     * - `socks5`: SOCKS5
     */
    export type TSystemNetworkProxyScheme = "" | "http" | "https" | "socks5";

    /**
     * The operating system name determined at compile time (obtained using the command `go tool
     * dist list`)
     * - `android`: Android
     * - `darwin`: macOS
     * - `ios`: iOS
     * - `linux`: Linux
     * - `windows`: Windows
     */
    export type TSystemOS = "android" | "darwin" | "ios" | "linux" | "windows";

    /**
     * SiYuan tag dock related configuration
     */
    export interface ITag {
        /**
         * Tag sorting scheme
         * - `0`: Name alphabetically ascending
         * - `1`: Name alphabetically descending
         * - `4`: Name natural ascending
         * - `5`: Name natural descending
         * - `7`: Reference count ascending
         * - `8`: Reference count descending
         */
        sort: number;
    }

    /**
     * SiYuan UI layout related configuration
     */
    export interface IUiLayout {
        bottom: IUILayoutDock;
        /**
         * Whether to hide the sidebar
         */
        hideDock: boolean;
        layout: IUILayoutLayout;
        left: IUILayoutDock;
        right: IUILayoutDock;
    }

    /**
     * SiYuan dock related configuration
     */
    export interface IUILayoutDock {
        /**
         * Dock area list
         */
        data: Array<IUILayoutDockTab[]>;
        /**
         * Whether to pin the dock
         */
        pin: boolean;
    }

    /**
     * SiYuan dock tab data
     */
    export interface IUILayoutDockTab {
        /**
         * Dock tab hotkey
         */
        hotkey?: string;
        /**
         * Hotkey description ID
         */
        hotkeyLangId?: string;
        /**
         * Tab icon ID
         */
        icon: string;
        /**
         * Whether to display the tab
         */
        show: boolean;
        size: IUILayoutDockPanelSize;
        /**
         * Tab title
         */
        title?: string;
        /**
         * Tab type
         */
        type: string;
    }

    /**
     * SiYuan dock tab size
     */
    export interface IUILayoutDockPanelSize {
        /**
         * Tab height (unit: px)
         */
        height: number | null;
        /**
         * Tab width (unit: px)
         */
        width: number | null;
    }

    /**
     * SiYuan layout item
     */
    export type TUILayoutItem = IUILayoutLayout
        | IUILayoutWnd
        | IUILayoutTab
        | IUILayoutTabEditor
        | IUILayoutTabAsset
        | IUILayoutTabCustom
        | IUILayoutTabBacklink
        | IUILayoutTabBookmark
        | IUILayoutTabFiles
        | IUILayoutTabGraph
        | IUILayoutTabOutline
        | IUILayoutTabTag
        | IUILayoutTabSearch;

    /**
     * SiYuan panel layout
     */
    export interface IUILayoutLayout {
        /**
         * Internal elements
         */
        children: (IUILayoutLayout | IUILayoutWnd)[];
        /**
         * Panel content layout direction
         * - `tb`: Top and bottom layout
         * - `lr`: Left and right layout
         */
        direction?: TUILayoutDirection;
        /**
         * Object name
         */
        instance: "Layout";
        /**
         * The direction in which the size can be adjusted
         * - `tb`: Can adjust the size up and down
         * - `lr`: Can adjust the size left and right
         */
        resize?: TUILayoutDirection;
        /**
         * Panel size
         */
        size?: string;
        /**
         * Layout type
         * - `normal`: Normal panel
         * - `center`: Center panel
         * - `top`: Top panel
         * - `bottom`: Bottom panel
         * - `left`: Left panel
         * - `right`: Right panel
         */
        type?: TUILayoutType;
    }

    /**
     * SiYuan window layout
     */
    export interface IUILayoutWnd {
        /**
         * Internal elements
         */
        children: IUILayoutTab[];
        /**
         * Panel height
         */
        height?: string;
        /**
         * Object name
         */
        instance: "Wnd";
        /**
         * The direction in which the size can be adjusted
         * - `tb`: Can adjust the size up and down
         * - `lr`: Can adjust the size left and right
         */
        resize?: TUILayoutDirection;
        /**
         * Panel width
         */
        width?: string;
    }


    export interface IUILayoutTab {
        /**
         * Whether the tab is active
         */
        active?: boolean;
        /**
         * Tab content
         */
        children: (IUILayoutTabAsset | IUILayoutTabBacklink | IUILayoutTabCustom | IUILayoutTabEditor)[];
        /**
         * Tab icon
         */
        docIcon?: string;
        /**
         * Icon reference ID
         */
        icon?: string;
        /**
         * Object name
         */
        instance: "Tab";
        /**
         * Localization field key name
         */
        lang?: string;
        /**
         * Whether the tab is pinned
         */
        pin?: boolean;
        /**
         * Tab title
         */
        title?: string;
    }

    /**
     * Tab content
     *
     * SiYuan asset file tab
     */
    export interface IUILayoutTabAsset {
        /**
         * Object name
         */
        instance: "Asset";
        /**
         * (Asset) PDF file page number
         */
        page?: number;
        /**
         * (Asset) Asset reference path
         */
        path: string;
    }


    /**
     * SiYuan back link tab
     */
    export interface IUILayoutTabBacklink {
        /**
         * (Backlink) Block ID
         */
        blockId: string;
        /**
         * Object name
         */
        instance: "Backlink";
        /**
         * (Backlink) Document block ID
         */
        rootId: string;
        /**
         * (Backlink) Tab type
         * - `pin`: Pinned panel
         * - `local`: The panel of the current document
         */
        type: TUILayoutTabBacklinkType;
    }

    /**
     * (Backlink) Tab type
     * - `pin`: Pinned panel
     * - `local`: The panel of the current document
     */
    export type TUILayoutTabBacklinkType = "pin" | "local";

    /**
     * SiYuan bookmark tab
     */
    export interface IUILayoutTabBookmark {
        /**
         * Object name
         */
        instance: "Bookmark";
    }

    /**
     * SiYuan custom tab
     */
    export interface IUILayoutTabCustom {
        /**
         * (Custom) Data of the custom tab
         */
        customModelData: any;
        /**
         * (Custom) Type of the custom tab
         */
        customModelType: string;
        /**
         * Object name
         */
        instance: "Custom";
    }

    /**
     * SiYuan editor tab
     */
    export interface IUILayoutTabEditor {
        /**
         * (Editor) Actions to be performed after the tab is loaded
         */
        action: string;
        /**
         * (Editor) Block ID
         */
        blockId: string;
        /**
         * Object name
         */
        instance: "Editor";
        /**
         * (Editor) Editor mode
         * - `wysiwyg`: WYSIWYG mode
         * - `preview`: Export preview mode
         */
        mode: TEditorMode;
        /**
         * (Editor) Notebook ID
         */
        notebookId: string;
        /**
         * (Editor) Document block ID
         */
        rootId: string;
    }

    /**
     * SiYuan filetree tab
     */
    export interface IUILayoutTabFiles {
        /**
         * Object name
         */
        instance: "Files";
    }


    /**
     * SiYuan graph tab
     */
    export interface IUILayoutTabGraph {
        /**
         * (Graph) Block ID
         */
        blockId: string;
        /**
         * Object name
         */
        instance: "Graph";
        /**
         * (Graph) Document block ID
         */
        rootId: string;
        /**
         * (Graph) Tab type
         * - `pin`: Pinned graph
         * - `local`: Graph of the current editor
         * - `global`: Global graph
         */
        type: TUILayoutTabGraphType;
    }


    /**
     * (Graph) Tab type
     * - `pin`: Pinned graph
     * - `local`: Graph of the current editor
     * - `global`: Global graph
     */
    export type TUILayoutTabGraphType = "pin" | "local" | "global";

    /**
     * SiYuan outline tab
     */
    export interface IUILayoutTabOutline {
        /**
         * (Outline) Block ID
         */
        blockId: string;
        /**
         * Object name
         */
        instance: "Outline";
        /**
         * (Outline) Whether the associated editor is in preview mode
         */
        isPreview: boolean;
        /**
         * (Outline) Tab type
         * - `pin`: Pinned outline panel
         * - `local`: The outline panel of the current editor
         */
        type: TUILayoutTabOutlineType;
    }


    /**
     * (Outline) Tab type
     * - `pin`: Pinned outline panel
     * - `local`: The outline panel of the current editor
     */
    export type TUILayoutTabOutlineType = "pin" | "local";

    /**
     * SiYuan tag tab
     */
    export interface IUILayoutTabTag {
        /**
         * Object name
         */
        instance: "Tag";
    }

    /**
     * SiYuan search tab
     */
    export interface IUILayoutTabSearch {
        config: IUILayoutTabSearchConfig;
        /**
         * Object name
         */
        instance: "Search";
    }

    /**
     * SiYuan search tab configuration
     */
    export interface IUILayoutTabSearchConfig {
        /**
         * Grouping strategy
         * - `0`: No grouping
         * - `1`: Group by document
         */
        group: number;
        hasReplace: boolean;
        /**
         * Readable path list
         */
        hPath: string;
        /**
         * Search in the specified paths
         */
        idPath: string[];
        /**
         * Search content
         */
        k: string;
        /**
         * Search scheme
         * - `0`: Keyword (default)
         * - `1`: Query syntax
         * - `2`: SQL
         * - `3`: Regular expression
         * @default 0
         */
        method: number;
        /**
         * Custom name of the query condition group
         */
        name?: string;
        /**
         * Current page number
         */
        page: number;
        /**
         * Replace content
         */
        r: string;
        /**
         * Whether to clear the search box after removing the currently used query condition group
         * 移除后需记录搜索内容 https://github.com/siyuan-note/siyuan/issues/7745
         */
        removed?: boolean;
        replaceTypes: IUILayoutTabSearchConfigReplaceTypes;
        /**
         * Search result sorting scheme
         * - `0`: Block type (default)
         * - `1`: Ascending by creation time
         * - `2`: Descending by creation time
         * - `3`: Ascending by update time
         * - `4`: Descending by update time
         * - `5`: By content order (only valid when grouping by document)
         * - `6`: Ascending by relevance
         * - `7`: Descending by relevance
         * @default 0
         */
        sort: number;
        types: IUILayoutTabSearchConfigTypes;
    }

    /**
     * Replace type filtering
     */
    export interface IUILayoutTabSearchConfigReplaceTypes {
        /**
         * Replace hyperlinks
         * @default false
         */
        aHref?: boolean;
        /**
         * Replace hyperlink anchor text
         * @default true
         */
        aText?: boolean;
        /**
         * Replace hyperlink title
         * @default true
         */
        aTitle?: boolean;
        /**
         * Replace inline code
         * @default false
         */
        code?: boolean;
        /**
         * Replace code blocks
         * @default false
         */
        codeBlock?: boolean;
        /**
         * Replace document title
         * @default true
         */
        docTitle?: boolean;
        /**
         * Replace italic elements
         * @default true
         */
        em?: boolean;
        /**
         * Replace HTML blocks
         * @default false
         */
        htmlBlock?: boolean;
        /**
         * Replace image addresses
         * @default false
         */
        imgSrc?: boolean;
        /**
         * Replace image anchor text
         * @default true
         */
        imgText?: boolean;
        /**
         * Replace image titles
         * @default true
         */
        imgTitle?: boolean;
        /**
         * Replace inline formulas
         * @default false
         */
        inlineMath?: boolean;
        /**
         * Replace inline memos
         * @default true
         */
        inlineMemo?: boolean;
        /**
         * Replace block refs
         * @default false
         */
        blockRef?: boolean;
        /**
         * Replace kdb elements
         * @default true
         */
        kbd?: boolean;
        /**
         * Replace mark elements
         * @default true
         */
        mark?: boolean;
        /**
         * Replace formula blocks
         * @default false
         */
        mathBlock?: boolean;
        /**
         * Replace delete elements
         * @default true
         */
        s?: boolean;
        /**
         * Replace bold elements
         * @default true
         */
        strong?: boolean;
        /**
         * Replace subscript elements
         * @default true
         */
        sub?: boolean;
        /**
         * Replace superscript elements
         * @default true
         */
        sup?: boolean;
        /**
         * Replace tag elements
         * @default true
         */
        tag?: boolean;
        /**
         * Replace rich text elements
         * @default true
         */
        text?: boolean;
        /**
         * Replace underline elements
         * @default true
         */
        u?: boolean;
    }

    /**
     * Search type filtering
     */
    export interface IUILayoutTabSearchConfigTypes {
        /**
         * Search results contain audio blocks
         * @default false
         */
        audioBlock: boolean;
        /**
         * Search results contain blockquote blocks
         * @default false
         */
        blockquote: boolean;
        /**
         * Search results contain code blocks
         * @default false
         */
        codeBlock: boolean;
        /**
         * Search results contain database blocks
         * @default false
         */
        databaseBlock: boolean;
        /**
         * Search results contain document blocks
         * @default false
         */
        document: boolean;
        /**
         * Search results contain embed blocks
         * @default false
         */
        embedBlock: boolean;
        /**
         * Search results contain heading blocks
         * @default false
         */
        heading: boolean;
        /**
         * Search results contain html blocks
         * @default false
         */
        htmlBlock: boolean;
        /**
         * Search results contain iframe blocks
         * @default false
         */
        iframeBlock: boolean;
        /**
         * Search results contain list blocks
         * @default false
         */
        list: boolean;
        /**
         * Search results contain list item blocks
         * @default false
         */
        listItem: boolean;
        /**
         * Search results contain math blocks
         * @default false
         */
        mathBlock: boolean;
        /**
         * Search results contain paragraph blocks
         * @default false
         */
        paragraph: boolean;
        /**
         * Search results contain super blocks
         * @default false
         */
        superBlock: boolean;
        /**
         * Search results contain table blocks
         * @default false
         */
        table: boolean;
        /**
         * Search results contain video blocks
         * @default false
         */
        videoBlock: boolean;
        /**
         * Search results contain widget blocks
         * @default false
         */
        widgetBlock: boolean;
    }


    /**
     * Panel content layout direction
     * - `tb`: Top and bottom layout
     * - `lr`: Left and right layout
     *
     * The direction in which the size can be adjusted
     * - `tb`: Can adjust the size up and down
     * - `lr`: Can adjust the size left and right
     */
    export type TUILayoutDirection = "tb" | "lr";

    /**
     * Layout type
     * - `normal`: Normal panel
     * - `center`: Center panel
     * - `top`: Top panel
     * - `bottom`: Bottom panel
     * - `left`: Left panel
     * - `right`: Right panel
     */
    export type TUILayoutType = "normal" | "center" | "top" | "bottom" | "left" | "right";

}
