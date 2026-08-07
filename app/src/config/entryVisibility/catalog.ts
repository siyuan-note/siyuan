export interface IEntryCatalogNode {
    key: string;
    label: () => string;
    simple: boolean;
    type: "entry" | "separator";
    children?: IEntryCatalogNode[];
}

export interface IEntryCatalogSection {
    key: string;
    label: () => string;
    sortable?: boolean;
    children: IEntryCatalogNode[];
}

const lang = (key: string) => () => window.siyuan.languages[key] || key;
const literal = (value: string) => () => value;
const location = (...labels: Array<() => string>) => () => labels.map((label) => label()).join(" - ");
const node = (key: string, label: () => string, simple = true, children?: IEntryCatalogNode[]): IEntryCatalogNode => ({
    key,
    label,
    simple,
    type: "entry",
    children,
});
const separator = (key: string): IEntryCatalogNode => ({
    key,
    label: () => "",
    simple: true,
    type: "separator",
});

const copyChildren = () => [
    node("copyBlockRef", lang("copyBlockRef")),
    node("copyBlockEmbed", lang("copyBlockEmbed")),
    node("copyProtocol", lang("copyProtocol"), false),
    node("copyProtocolInMd", lang("copyProtocolInMd"), false),
    node("copyWebURL", lang("copyWebURL"), false),
    node("copyHPath", lang("copyHPath"), false),
    node("copyID", lang("copyID"), false),
];

const sortChildren = () => [
    node("fileNameASC", lang("fileNameASC"), false),
    node("fileNameDESC", lang("fileNameDESC"), false),
    node("fileNameNatASC", lang("fileNameNatASC")),
    node("fileNameNatDESC", lang("fileNameNatDESC")),
    separator("separator_1"),
    node("createdASC", lang("createdASC")),
    node("createdDESC", lang("createdDESC")),
    node("modifiedASC", lang("modifiedASC")),
    node("modifiedDESC", lang("modifiedDESC")),
    separator("separator_2"),
    node("refCountASC", lang("refCountASC")),
    node("refCountDESC", lang("refCountDESC")),
    separator("separator_3"),
    node("docSizeASC", lang("docSizeASC")),
    node("docSizeDESC", lang("docSizeDESC")),
    separator("separator_4"),
    node("subDocCountASC", lang("subDocCountASC")),
    node("subDocCountDESC", lang("subDocCountDESC")),
    separator("separator_5"),
    node("customSort", lang("customSort")),
    node("sortByFiletree", lang("sortByFiletree")),
];

const exportChildren = () => [
    node("exportTemplate", lang("template")),
    node("exportSiYuanZip", literal("SiYuan .sy.zip")),
    node("exportMarkdown", literal("Markdown .zip")),
    node("exportImage", lang("image")),
    node("exportPDF", literal("PDF")),
    node("exportHTML_SiYuan", literal("HTML (SiYuan)"), false),
    node("exportHTML_Markdown", literal("HTML (Markdown)"), false),
    node("exportWord", literal("Word .docx")),
    node("exportMore", lang("more"), false, [
        node("exportReStructuredText", literal("reStructuredText"), false),
        node("exportAsciiDoc", literal("AsciiDoc"), false),
        node("exportTextile", literal("Textile"), false),
        node("exportOPML", literal("OPML"), false),
        node("exportOrgMode", literal("Org-Mode"), false),
        node("exportMediaWiki", literal("MediaWiki"), false),
        node("exportODT", literal("ODT"), false),
        node("exportRTF", literal("RTF"), false),
        node("exportEPUB", literal("EPUB"), false),
    ]),
];

const openChildren = () => [
    node("insertRight", lang("insertRight")),
    node("insertBottom", lang("insertBottom")),
    node("openInNewTab", lang("openInNewTab")),
    node("openByNewWindow", lang("openByNewWindow")),
    separator("separator_1"),
    node("preview", lang("preview")),
    separator("separator_2"),
    node("showInFolder", lang("showInFolder")),
];

const importChildren = () => [
    node("importSiYuanZip", literal("SiYuan .sy.zip")),
    node("importMarkdownZip", literal("Markdown .zip")),
    node("importMarkdownDoc", () => `Markdown ${window.siyuan.languages.doc}`),
    node("importMarkdownFolder", () => `Markdown ${window.siyuan.languages.folder}`),
];

const docTreeCommon = (multi = false) => [
    node("copy", lang("copy"), true, [...copyChildren(), node("duplicate", lang("duplicate"))]),
    node("move", lang("move")),
    node("addToDatabase", lang("addToDatabase"), false),
    node("delete", lang("delete")),
    node("riffCard", lang("riffCard"), false, [
        node("spaceRepetition", lang("spaceRepetition")),
        node("manage", lang("manage")),
        node("quickMakeCard", lang("quickMakeCard")),
        node("removeCard", lang("removeCard")),
        node("addToDeck", lang("addToDeck")),
    ]),
    node("openBy", lang("openBy"), true, openChildren()),
    node("export", lang("export"), true, multi ? [
        node("exportSiYuanZip", literal("SiYuan .sy.zip")),
        node("exportMarkdown", literal("Markdown .zip")),
    ] : exportChildren()),
];

const docTreeDocument = () => {
    const [copy, move, addToDatabase, remove, riffCard, openBy, exportEntry] = docTreeCommon();
    return [
        node("openDocument", lang("openDocument")),
        node("newDocAbove", lang("newDocAbove")),
        node("newDocBelow", lang("newDocBelow")),
        separator("separator_1"),
        copy,
        move,
        addToDatabase,
        remove,
        separator("separator_2"),
        node("rename", lang("rename")),
        node("attr", lang("attr")),
        riffCard,
        node("search", lang("search")),
        node("replace", lang("replace")),
        separator("separator_3"),
        openBy,
        node("fileHistory", lang("dataHistory")),
        node("import", lang("import"), true, importChildren()),
        exportEntry,
    ];
};

const docTreeMultiple = () => {
    const [copy, move, addToDatabase, remove, riffCard, openBy, exportEntry] = docTreeCommon(true);
    return [copy, move, addToDatabase, remove, separator("separator_1"), riffCard,
        separator("separator_2"), openBy, exportEntry];
};

const gutterCopyChildren = () => [
    ...copyChildren(),
    node("copyRichText", lang("copyRichText")),
    node("copyPlainText", lang("copyPlainText")),
    node("copyText", lang("copyText")),
    node("copy", lang("copy")),
    node("copyAVID", lang("copyAVID")),
    node("duplicate", lang("duplicate")),
    node("duplicateMirror", lang("duplicateMirror")),
    node("duplicateCompletely", lang("duplicateCompletely")),
];

const gutterTurnInto = () => node("turnInto", lang("turnInto"), true, [
        node("paragraph", lang("paragraph")),
        node("heading1", lang("heading1")),
        node("heading2", lang("heading2")),
        node("heading3", lang("heading3")),
        node("heading4", lang("heading4")),
        node("heading5", lang("heading5")),
        node("heading6", lang("heading6")),
        node("quote", lang("quote")),
        node("callout", lang("callout")),
        node("list", lang("list")),
        node("orderedList", lang("ordered-list")),
        node("check", lang("check")),
        node("code", lang("code")),
        node("table", lang("table")),
        node("line", lang("line")),
        node("math", lang("math")),
        node("includeSublists", lang("includeSublists"), true, [
            node("recursiveParagraph", lang("paragraph")),
            node("recursiveList", lang("list")),
            node("recursiveOrderedList", lang("ordered-list")),
            node("recursiveCheck", lang("check")),
        ]),
    ]);

const gutterLayout = () => node("layout", lang("layout"), true, [
    node("alignLeft", lang("alignLeft")),
    node("alignCenter", lang("alignCenter")),
    node("alignRight", lang("alignRight")),
    node("justify", lang("justify")),
    separator("separator_1"),
    node("ltr", lang("ltr")),
    node("rtl", lang("rtl")),
    separator("separator_2"),
    node("clearFontStyle", lang("clearFontStyle")),
]);

const gutterWidth = () => node("width", lang("width"), true, [
    node("widthInput", lang("width")),
    node("width_25%", literal("25%")),
    node("width_33%", literal("33%")),
    node("width_50%", literal("50%")),
    node("width_67%", literal("67%")),
    node("width_75%", literal("75%")),
    node("width_100%", literal("100%")),
    separator("separator_1"),
    node("widthDrag", lang("width")),
    separator("separator_2"),
    node("default", lang("default")),
]);

const gutterTable = () => node("table", lang("table"), true, [
    node("useDefaultWidth", lang("useDefaultWidth")),
    node("pinTableHead", lang("pinTableHead")),
    node("unpinTableHead", lang("unpinTableHead")),
    node("tableHeaderRow", lang("tableHeaderRow")),
    node("tableHeaderColumn", lang("tableHeaderColumn")),
    node("title", lang("title")),
    separator("separator_1"),
    node("alignment", lang("alignment"), true, [
        node("alignLeft", lang("alignLeft")),
        node("alignCenter", lang("alignCenter")),
        node("alignRight", lang("alignRight")),
        node("useDefaultAlign", lang("useDefaultAlign")),
        separator("separator_verticalAlign"),
        node("alignTop", lang("alignTop")),
        node("alignMiddle", lang("alignMiddle")),
        node("alignBottom", lang("alignBottom")),
        node("useDefaultVerticalAlign", lang("useDefaultVerticalAlign")),
    ]),
    separator("separator_insert"),
    node("insertRowAbove", lang("insertRowAbove")),
    node("insertRowBelow", lang("insertRowBelow")),
    node("insertColumnLeft", lang("insertColumnLeft")),
    node("insertColumnRight", lang("insertColumnRight")),
    separator("separator_2"),
    node("moveToUp", lang("moveToUp")),
    node("moveToDown", lang("moveToDown")),
    node("moveToLeft", lang("moveToLeft")),
    node("moveToRight", lang("moveToRight")),
    separator("separator_delete"),
    node("deleteRow", lang("delete-row")),
    node("deleteColumn", lang("delete-column")),
]);

const gutterBase = (multi: boolean) => [
    gutterTurnInto(),
    ...(multi ? [node("mergeSuperBlock", () => `${window.siyuan.languages.merge} ${window.siyuan.languages.superBlock}`, true, [
        node("hLayout", lang("hLayout")),
        node("vLayout", lang("vLayout")),
    ])] : []),
    node("ai", lang("aiEdit")),
    node("copy", lang("copy"), true, gutterCopyChildren()),
    node("cut", lang("cut")),
    node("move", lang("move")),
    node("addToDatabase", lang("addToDatabase"), false),
    node("addToAgent", lang("addToAgent")),
    node("delete", lang("delete")),
];

const gutterMultiple = () => [
    ...gutterBase(true),
    separator("separator_appearance"),
    node("appearance", lang("appearance")),
    gutterLayout(),
    gutterWidth(),
    separator("separator_quickMakeCard"),
    node("quickMakeCard", lang("quickMakeCard"), false),
    node("removeCard", lang("removeCard"), false),
    node("addToDeck", lang("addToDeck"), false),
];

const gutterSingle = () => [
    ...gutterBase(false),
    separator("separator_cancelSuperBlock"),
    node("superBlock", lang("superBlock"), true, [
        node("cancelSuperBlock", () => `${window.siyuan.languages.cancel} ${window.siyuan.languages.superBlock}`),
        node("turnIntoVLayout", () => `${window.siyuan.languages.turnInto} ${window.siyuan.languages.vLayout}`),
        node("turnIntoHLayout", () => `${window.siyuan.languages.turnInto} ${window.siyuan.languages.hLayout}`),
        node("superBlockAlignment", lang("alignment"), true, [
            node("alignTop", lang("alignTop")),
            node("alignMiddle", lang("alignMiddle")),
            node("alignBottom", lang("alignBottom")),
            node("useDefaultVerticalAlign", lang("useDefaultVerticalAlign")),
        ]),
    ]),
    separator("separator_code"),
    node("code", lang("code"), true, [
        node("md31", lang("md31")),
        node("md2", lang("md2")),
        node("md27", lang("md27")),
        node("saveCodeBlockAsFile", lang("saveCodeBlockAsFile")),
    ]),
    separator("separator_chart"),
    node("chart", lang("chart"), true, [node("height", lang("height")), node("update", lang("update"))]),
    separator("separator_table"),
    gutterTable(),
    separator("separator_exportCSV"),
    node("exportCSV", () => `${window.siyuan.languages.export} CSV`),
    node("showDatabaseInFolder", lang("showInFolder")),
    separator("separator_VideoOrAudio"),
    node("assetVideo", location(lang("video"), lang("assets")), true, [
        node("asset", lang("assets")),
        separator("separator_rename"),
        node("rename", lang("rename")),
        node("openBy", lang("openBy")),
        node("export", lang("export")),
        node("copyFile", lang("copyFile")),
    ]),
    node("assetAudio", location(lang("audio"), lang("assets")), true, [
        node("asset", lang("assets")),
        separator("separator_rename"),
        node("rename", lang("rename")),
        node("openBy", lang("openBy")),
        node("export", lang("export")),
        node("copyFile", lang("copyFile")),
    ]),
    separator("separator_IFrame"),
    node("assetIFrame", location(literal("IFrame"), lang("assets")), true, [
        node("asset", lang("assets")),
        separator("separator_openBy"),
        node("openBy", lang("openBy")),
    ]),
    separator("separator_html"),
    node("html", literal("HTML")),
    separator("separator_blockEmbed"),
    node("blockEmbed", lang("blockEmbed"), true, [
        node("refresh", lang("refresh")),
        node("update", lang("update")),
        separator("separator_breadcrumb"),
        node("embedBlockBreadcrumb", lang("embedBlockBreadcrumb")),
        node("headingEmbedMode", lang("headingEmbedMode"), true, [
            node("showHeadingWithBlocks", lang("showHeadingWithBlocks")),
            node("showHeadingOnlyTitle", lang("showHeadingOnlyTitle")),
            node("showHeadingOnlyBlocks", lang("showHeadingOnlyBlocks")),
            node("default", lang("default")),
        ]),
    ]),
    separator("separator_1"),
    node("tWithSubtitle", lang("tWithSubtitle"), true, [
        node("heading1", lang("heading1")),
        node("heading2", lang("heading2")),
        node("heading3", lang("heading3")),
        node("heading4", lang("heading4")),
        node("heading5", lang("heading5")),
        node("heading6", lang("heading6")),
    ]),
    node("copyHeadings1", () => `${window.siyuan.languages.copy} ${window.siyuan.languages.headings1}`),
    node("cutHeadings1", () => `${window.siyuan.languages.cut} ${window.siyuan.languages.headings1}`),
    node("deleteHeadings1", () => `${window.siyuan.languages.delete} ${window.siyuan.languages.headings1}`),
    separator("separator_2"),
    node("enter", lang("enter")),
    node("enterBack", lang("enterBack"), false),
    node("insertBefore", lang("insertBefore")),
    node("insertAfter", lang("insertAfter")),
    node("jumpTo", lang("jumpTo"), false, [
        node("jumpToParentPrev", lang("jumpToParentPrev"), false),
        node("jumpToParentNext", lang("jumpToParentNext"), false),
        node("jumpToParent", lang("jumpToParent"), false),
    ]),
    separator("separator_3"),
    node("fold", lang("fold")),
    node("foldChildHeadings", lang("foldChildHeadings")),
    node("foldSiblingHeadings", lang("foldSiblingHeadings")),
    node("foldRecursive", lang("foldRecursive")),
    node("attr", lang("attr")),
    node("appearance", lang("appearance")),
    gutterLayout(),
    gutterWidth(),
    separator("separator_4"),
    node("wechatReminder", lang("wechatReminder"), false),
    node("quickMakeCard", lang("quickMakeCard"), false),
    node("removeCard", lang("removeCard"), false),
    node("addToDeck", lang("addToDeck"), false),
    separator("separator_5"),
    node("updateAndCreatedAt", () => `${window.siyuan.languages.modifiedAt} / ${window.siyuan.languages.createdAt}`, false),
];

export const entryCatalog: IEntryCatalogSection[] = [
    {
        key: "dock",
        label: lang("toggleDock"),
        sortable: false,
        children: [
            node("file", lang("fileTree")),
            node("outline", lang("outline")),
            node("bookmark", lang("bookmark")),
            node("tag", lang("tag")),
            node("backlink", lang("backlinks")),
            node("agentChat", lang("ai")),
            node("inbox", lang("inbox"), false),
            node("graph", lang("graphView"), false),
            node("globalGraph", lang("globalGraph"), false),
        ],
    },
    {
        key: "docTree.panel",
        label: location(lang("entryDocPanel"), lang("more")),
        children: [
            node("newNotebook", lang("newNotebook")),
            node("newEncryptedNotebook", lang("newEncryptedNotebook")),
            node("rebuildDataIndex", lang("rebuildDataIndex")),
            node("sort", lang("sort"), true, sortChildren()),
            node("publishAccess", lang("publishAccess")),
        ],
    },
    {
        key: "docTree.notebook",
        label: location(lang("entryDocPanel"), lang("agentCatNotebook"), lang("more")),
        children: [
            node("openDocument", lang("openDocument")),
            node("rename", lang("rename")),
            node("config", lang("config")),
            node("sort", lang("sort"), true, sortChildren()),
            node("riffCard", lang("riffCard"), false),
            node("search", lang("search")),
            node("replace", lang("replace")),
            separator("separator_1"),
            node("close", lang("close")),
            node("delete", lang("delete")),
            separator("separator_2"),
            node("showInFolder", lang("showInFolder")),
            node("import", lang("import"), true, importChildren()),
            node("export", lang("export"), true, [
                node("exportSiYuanZip", literal("SiYuan .sy.zip")),
                node("exportMarkdown", literal("Markdown .zip")),
            ]),
        ],
    },
    {
        key: "docTree.document",
        label: location(lang("entryDocPanel"), lang("doc"), lang("more")),
        children: docTreeDocument(),
    },
    {
        key: "docTree.multi",
        label: location(lang("entryDocPanel"), lang("multiSelect"), lang("more")),
        children: docTreeMultiple(),
    },
    {
        key: "document.title",
        label: location(lang("editor"), lang("entryDocumentMenu")),
        children: [
            node("copy", lang("copy"), true, [...copyChildren(), node("copyMarkdown", lang("copyMarkdown")), node("copyDoc", lang("copyDoc"), false)]),
            node("move", lang("move")),
            node("addToDatabase", lang("addToDatabase"), false),
            node("delete", lang("delete")),
            separator("separator_1"),
            node("outline", lang("outline")),
            node("backlinks", lang("backlinks")),
            node("graphView", lang("graphView")),
            separator("separator_2"),
            node("attr", lang("attr")),
            node("wechatReminder", lang("wechatReminder"), false),
            node("riffCard", lang("riffCard"), false, [
                node("spaceRepetition", lang("spaceRepetition"), false),
                node("manage", lang("manage"), false),
                node("quickMakeCard", lang("quickMakeCard"), false),
                node("removeCard", lang("removeCard"), false),
                node("addToDeck", lang("addToDeck"), false),
            ]),
            node("search", lang("search")),
            node("transferBlockRef", lang("transferBlockRef")),
            separator("separator_3"),
            node("openBy", lang("openBy")),
            node("openByNewWindow", lang("openByNewWindow")),
            node("showInFolder", lang("showInFolder")),
            node("fileHistory", lang("dataHistory")),
            node("export", lang("export"), true, exportChildren()),
            separator("separator_4"),
            node("updateAndCreatedAt", () => `${window.siyuan.languages.modifiedAt} / ${window.siyuan.languages.createdAt}`),
        ],
    },
    {
        key: "document.more",
        label: location(lang("editor"), lang("entryDocumentMoreMenu")),
        children: [
            node("insertImage", lang("insertImage")),
            node("insertAsset", lang("insertAsset")),
            node("startRecord", lang("startRecord"), false),
            node("endRecord", lang("endRecord"), false),
            node("netImg2LocalAsset", lang("netImg2LocalAsset")),
            node("netAssets2LocalAssets", lang("netAssets2LocalAssets"), false),
            node("uploadAssets2CDN", lang("uploadAssets2CDN"), false),
            node("share2Liandi", lang("share2Liandi"), false),
            node("keepLazyLoad", lang("keepLazyLoad")),
            separator("separator_1"),
            node("refresh", lang("refresh")),
            node("optimizeTypography", lang("optimizeTypography")),
            node("fullscreen", lang("fullscreen")),
            node("editMode", lang("edit-mode"), true, [
                node("wysiwyg", lang("wysiwyg")),
                node("preview", lang("preview")),
            ]),
            node("editReadonly", lang("editReadonly"), false, [
                node("enable", lang("enable"), false),
                node("disable", lang("disable"), false),
            ]),
            node("fullWidth", lang("fullWidth"), false, [
                node("enable", lang("enable"), false),
                node("disable", lang("disable"), false),
                node("default", lang("default"), false),
            ]),
            node("headingNumber", lang("headingNumber"), true, [
                node("enable", lang("enable")),
                node("disable", lang("disable")),
                node("default", lang("default")),
            ]),
            separator("separator_2"),
            node("docInfo", lang("blockCount"), false),
        ],
    },
    {
        key: "gutter.single",
        label: location(lang("editor"), lang("entryGutterMenu"), lang("blockCount")),
        children: gutterSingle(),
    },
    {
        key: "gutter.multi",
        label: location(lang("editor"), lang("entryGutterMenu"), lang("multiSelect")),
        children: gutterMultiple(),
    },
    {
        key: "inline.text",
        label: location(lang("editor"), lang("entryInlineMenu"), lang("text")),
        children: [
            node("copy", lang("copy")),
            node("copyRichText", lang("copyRichText")),
            node("copyPlainText", lang("copyPlainText")),
            node("cut", lang("cut")),
            node("delete", lang("delete")),
            separator("separator_paste"),
            node("paste", lang("paste")),
            node("pasteAsPlainText", lang("pasteAsPlainText")),
            node("pasteEscaped", lang("pasteEscaped"), false),
            node("selectAll", lang("selectAll")),
            separator("separator_1"),
            node("insertRowAbove", lang("insertRowAbove")),
            node("insertRowBelow", lang("insertRowBelow")),
            node("insertColumnLeft", lang("insertColumnLeft")),
            node("insertColumnRight", lang("insertColumnRight")),
            separator("separator_2"),
            node("deleteRow", lang("delete-row")),
            node("deleteColumn", lang("delete-column")),
            separator("separator_3"),
            node("more", lang("more"), true, [
                node("useDefaultWidth", lang("useDefaultWidth")),
                node("pinTableHead", lang("pinTableHead")),
                node("unpinTableHead", lang("unpinTableHead")),
                node("tableHeaderRow", lang("tableHeaderRow")),
                node("tableHeaderColumn", lang("tableHeaderColumn")),
                node("title", lang("title")),
                separator("separator_1"),
                node("alignLeft", lang("alignLeft")),
                node("alignCenter", lang("alignCenter")),
                node("alignRight", lang("alignRight")),
                node("useDefaultAlign", lang("useDefaultAlign")),
                separator("separator_insert"),
                node("insertRowAbove", lang("insertRowAbove")),
                node("insertRowBelow", lang("insertRowBelow")),
                node("insertColumnLeft", lang("insertColumnLeft")),
                node("insertColumnRight", lang("insertColumnRight")),
                separator("separator_2"),
                node("moveToUp", lang("moveToUp")),
                node("moveToDown", lang("moveToDown")),
                node("moveToLeft", lang("moveToLeft")),
                node("moveToRight", lang("moveToRight")),
                separator("separator_delete"),
                node("deleteRow", lang("delete-row")),
                node("deleteColumn", lang("delete-column")),
            ]),
        ],
    },
    {
        key: "inline.image",
        label: location(lang("editor"), lang("entryInlineMenu"), lang("image")),
        children: [
            node("imageUrlAndTitleAndTooltipText", () => `${window.siyuan.languages.imageURL} / ${window.siyuan.languages.title} / ${window.siyuan.languages.tooltipText}`),
            separator("separator_1"),
            node("copy", lang("copy")),
            node("copyImageURL", () => `${window.siyuan.languages.copy} ${window.siyuan.languages.imageURL}`),
            node("cut", lang("cut")),
            node("delete", lang("delete")),
            separator("separator_2"),
            node("rename", lang("rename")),
            node("ocr", literal("OCR"), false, [
                node("ocrResult", lang("ocrResult"), false),
                separator("separator_reOCR"),
                node("reOCR", lang("reOCR"), false),
            ]),
            node("alignCenter", lang("alignCenter")),
            node("alignLeft", lang("alignLeft")),
            node("width", lang("width"), true, [
                node("widthInput", lang("width")),
                node("width_25%", literal("25%")),
                node("width_33%", literal("33%")),
                node("width_50%", literal("50%")),
                node("width_67%", literal("67%")),
                node("width_75%", literal("75%")),
                node("width_100%", literal("100%")),
                separator("separator_1"),
                node("widthDrag", lang("width")),
                separator("separator_2"),
                node("default", lang("default")),
            ]),
            node("height", lang("height"), true, [
                node("heightInput", lang("height")),
                node("width_25%", literal("25%")),
                node("width_33%", literal("33%")),
                node("width_50%", literal("50%")),
                node("width_67%", literal("67%")),
                node("width_75%", literal("75%")),
                node("width_100%", literal("100%")),
                separator("separator_1"),
                node("heightDrag", lang("height")),
                separator("separator_2"),
                node("default", lang("default")),
            ]),
            separator("separator_3"),
            node("export", lang("export")),
            node("copyFile", lang("copyFile"), false),
            node("copyAsPNG", lang("copyAsPNG"), false),
        ],
    },
    {
        key: "inline.ref",
        label: location(lang("editor"), lang("entryInlineMenu"), lang("ref")),
        children: [
            node("anchor", lang("anchor")),
            separator("separator_1"),
            node("openBy", lang("openBy")),
            node("refTab", lang("refTab")),
            node("insertRight", lang("insertRight")),
            node("insertBottom", lang("insertBottom")),
            node("openByNewWindow", lang("openByNewWindow")),
            separator("separator_2"),
            node("backlinks", lang("backlinks")),
            node("graphView", lang("graphView"), false),
            separator("separator_3"),
            node("turnToDynamic", lang("turnToDynamic")),
            node("turnToStatic", lang("turnToStatic")),
            node("turnInto", lang("turnInto"), true, [
                node("text", lang("text")),
                node("*", literal("*")),
                node("text*", () => `${window.siyuan.languages.text} *`),
                node("link", lang("hyperlink")),
                node("blockEmbed", lang("blockEmbed")),
                node("defBlock", lang("defBlock"), false),
                node("defBlockChildren", lang("defBlockChildren"), false),
            ]),
            node("copy", lang("copy")),
            node("cut", lang("cut")),
            node("remove", lang("remove")),
        ],
    },
    {
        key: "inline.link",
        label: location(lang("editor"), lang("entryInlineMenu"), lang("hyperlink")),
        children: [
            node("linkAndAnchorAndTitle", () => `${window.siyuan.languages.hyperlink} / ${window.siyuan.languages.text} / ${window.siyuan.languages.title}`),
            separator("separator_1"),
            node("copy", lang("copy")),
            node("copyAHref", lang("copyAHref")),
            node("cut", lang("cut")),
            node("remove", lang("remove")),
            node("rename", lang("rename")),
            node("turnIntoRef", lang("ref")),
            node("turnIntoText", lang("text")),
            separator("separator_2"),
            node("openBy", lang("openBy")),
            node("export", lang("export")),
            node("copyFile", lang("copyFile")),
        ],
    },
    {
        key: "inline.fileAnnotation",
        label: location(lang("editor"), lang("entryInlineMenu"), lang("export5")),
        children: [
            node("idAndAnchor", () => `ID / ${window.siyuan.languages.anchor}`),
            separator("separator_turnInto"),
            node("turnInto", lang("turnInto"), true, [
                node("text", lang("text")),
                node("text*", () => `${window.siyuan.languages.text} *`),
            ]),
            node("remove", lang("remove")),
        ],
    },
    {
        key: "inline.tag",
        label: location(lang("editor"), lang("entryInlineMenu"), lang("tag")),
        children: [
            node("tag", lang("tag")),
            separator("separator_1"),
            node("search", lang("search")),
            node("rename", lang("rename")),
            separator("separator_2"),
            node("turnIntoText", lang("text")),
            node("copy", lang("copy")),
            node("cut", lang("cut")),
            node("remove", lang("remove")),
        ],
    },
    {
        key: "inline.math",
        label: location(lang("editor"), lang("entryInlineMenu"), lang("math")),
        children: [node("copy", lang("copy")), node("cut", lang("cut")), node("remove", lang("remove"))],
    },
];

const entryMap = new Map<string, IEntryCatalogNode>();
const parentMap = new Map<string, string>();
const sectionMap = new Map(entryCatalog.map((section) => [section.key, section]));
const childrenMap = new Map<string, IEntryCatalogNode[]>();

const indexNodes = (prefix: string, nodes: IEntryCatalogNode[]) => {
    childrenMap.set(prefix, nodes);
    nodes.forEach((item) => {
        const path = `${prefix}.${item.key}`;
        entryMap.set(path, item);
        parentMap.set(path, prefix);
        if (item.children) {
            indexNodes(path, item.children);
        }
    });
};

entryCatalog.forEach((section) => indexNodes(section.key, section.children));

export const getEntryCatalogNode = (path: string) => entryMap.get(path);
export const getEntryParentPath = (path: string) => parentMap.get(path);
export const getEntryPaths = () => Array.from(entryMap.entries())
    .filter(([, item]) => item.type === "entry")
    .map(([path]) => path);
export const getEntryCatalogSection = (key: string) => sectionMap.get(key);
export const getEntryCatalogChildren = (path: string) => childrenMap.get(path);
export const getEntryOrderParents = () => Array.from(childrenMap.keys())
    .filter((path) => getEntryCatalogSection(path)?.sortable !== false);
export const getEntryCatalogPathChain = (sectionKey: string, path: string) => {
    const chain: string[] = [];
    let current: string | undefined = path;
    while (current && current !== sectionKey) {
        if (!getEntryCatalogNode(current)) {
            return [];
        }
        chain.unshift(current);
        current = getEntryParentPath(current);
    }
    return current === sectionKey ? chain : [];
};
