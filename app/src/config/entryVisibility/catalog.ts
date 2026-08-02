export interface IEntryCatalogNode {
    key: string;
    label: () => string;
    simple: boolean;
    children?: IEntryCatalogNode[];
}

export interface IEntryCatalogSection {
    key: string;
    label: () => string;
    children: IEntryCatalogNode[];
}

const lang = (key: string) => () => window.siyuan.languages[key] || key;
const literal = (value: string) => () => value;
const location = (...labels: Array<() => string>) => () => labels.map((label) => label()).join(" - ");
const node = (key: string, label: () => string, simple = true, children?: IEntryCatalogNode[]): IEntryCatalogNode => ({
    key,
    label,
    simple,
    children,
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
    node("createdASC", lang("createdASC")),
    node("createdDESC", lang("createdDESC")),
    node("modifiedASC", lang("modifiedASC")),
    node("modifiedDESC", lang("modifiedDESC")),
    node("refCountASC", lang("refCountASC")),
    node("refCountDESC", lang("refCountDESC")),
    node("docSizeASC", lang("docSizeASC")),
    node("docSizeDESC", lang("docSizeDESC")),
    node("subDocCountASC", lang("subDocCountASC")),
    node("subDocCountDESC", lang("subDocCountDESC")),
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
    node("preview", lang("preview")),
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

const gutterCommon = () => [
    node("turnInto", lang("turnInto"), true, [
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
    ]),
    node("mergeSuperBlock", () => `${window.siyuan.languages.merge} ${window.siyuan.languages.superBlock}`, true, [
        node("hLayout", lang("hLayout")),
        node("vLayout", lang("vLayout")),
    ]),
    node("ai", lang("aiEdit")),
    node("copy", lang("copy"), true, gutterCopyChildren()),
    node("cut", lang("cut")),
    node("move", lang("move")),
    node("addToDatabase", lang("addToDatabase"), false),
    node("addToAgent", lang("addToAgent")),
    node("delete", lang("delete")),
    node("appearance", lang("appearance")),
    node("layout", lang("layout"), true, [
        node("alignLeft", lang("alignLeft")),
        node("alignCenter", lang("alignCenter")),
        node("alignRight", lang("alignRight")),
        node("justify", lang("justify")),
        node("ltr", lang("ltr")),
        node("rtl", lang("rtl")),
        node("clearFontStyle", lang("clearFontStyle")),
    ]),
    node("width", lang("width"), true, [
        node("widthInput", lang("width")),
        node("width_25%", literal("25%")),
        node("width_33%", literal("33%")),
        node("width_50%", literal("50%")),
        node("width_67%", literal("67%")),
        node("width_75%", literal("75%")),
        node("width_100%", literal("100%")),
        node("widthDrag", lang("width")),
        node("default", lang("default")),
    ]),
    node("quickMakeCard", lang("quickMakeCard"), false),
    node("removeCard", lang("removeCard"), false),
    node("addToDeck", lang("addToDeck"), false),
    node("jumpTo", lang("jumpTo"), false, [
        node("jumpToParentPrev", lang("jumpToParentPrev"), false),
        node("jumpToParentNext", lang("jumpToParentNext"), false),
        node("jumpToParent", lang("jumpToParent"), false),
    ]),
    node("attr", lang("attr")),
    node("wechatReminder", lang("wechatReminder"), false),
    node("updateAndCreatedAt", () => `${window.siyuan.languages.modifiedAt} / ${window.siyuan.languages.createdAt}`, false),
    node("cancelSuperBlock", () => `${window.siyuan.languages.cancel} ${window.siyuan.languages.superBlock}`),
    node("turnIntoVLayout", () => `${window.siyuan.languages.turnInto} ${window.siyuan.languages.vLayout}`),
    node("turnIntoHLayout", () => `${window.siyuan.languages.turnInto} ${window.siyuan.languages.hLayout}`),
    node("code", lang("code"), true, [
        node("md31", lang("md31")),
        node("md2", lang("md2")),
        node("md27", lang("md27")),
        node("saveCodeBlockAsFile", lang("saveCodeBlockAsFile")),
    ]),
    node("chart", lang("chart"), true, [node("height", lang("height")), node("update", lang("update"))]),
    node("table", lang("table"), true, [
        node("useDefaultWidth", lang("useDefaultWidth")),
        node("pinTableHead", lang("pinTableHead")),
        node("unpinTableHead", lang("unpinTableHead")),
        node("title", lang("title")),
        node("alignLeft", lang("alignLeft")),
        node("alignCenter", lang("alignCenter")),
        node("alignRight", lang("alignRight")),
        node("useDefaultAlign", lang("useDefaultAlign")),
        node("insertRowAbove", lang("insertRowAbove")),
        node("insertRowBelow", lang("insertRowBelow")),
        node("insertColumnLeft", lang("insertColumnLeft")),
        node("insertColumnRight", lang("insertColumnRight")),
        node("moveToUp", lang("moveToUp")),
        node("moveToDown", lang("moveToDown")),
        node("moveToLeft", lang("moveToLeft")),
        node("moveToRight", lang("moveToRight")),
        node("deleteRow", lang("delete-row")),
        node("deleteColumn", lang("delete-column")),
    ]),
    node("exportCSV", () => `${window.siyuan.languages.export} CSV`),
    node("showDatabaseInFolder", lang("showInFolder")),
    node("assetVideo", lang("assets"), true, [
        node("asset", lang("assets")),
        node("rename", lang("rename")),
        node("openBy", lang("openBy")),
        node("export", lang("export")),
        node("copyFile", lang("copyFile")),
    ]),
    node("assetAudio", lang("assets"), true, [
        node("asset", lang("assets")),
        node("rename", lang("rename")),
        node("openBy", lang("openBy")),
        node("export", lang("export")),
        node("copyFile", lang("copyFile")),
    ]),
    node("assetIFrame", lang("assets"), true, [node("asset", lang("assets")), node("openBy", lang("openBy"))]),
    node("html", literal("HTML")),
    node("blockEmbed", lang("blockEmbed"), true, [
        node("refresh", lang("refresh")),
        node("update", lang("update")),
        node("embedBlockBreadcrumb", lang("embedBlockBreadcrumb")),
        node("headingEmbedMode", lang("headingEmbedMode"), true, [
            node("showHeadingWithBlocks", lang("showHeadingWithBlocks")),
            node("showHeadingOnlyTitle", lang("showHeadingOnlyTitle")),
            node("showHeadingOnlyBlocks", lang("showHeadingOnlyBlocks")),
            node("default", lang("default")),
        ]),
    ]),
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
    node("enter", lang("enter")),
    node("enterBack", lang("enterBack"), false),
    node("insertBefore", lang("insertBefore")),
    node("insertAfter", lang("insertAfter")),
    node("fold", lang("fold")),
    node("foldChildHeadings", lang("foldChildHeadings")),
    node("foldSiblingHeadings", lang("foldSiblingHeadings")),
    node("foldRecursive", lang("foldRecursive")),
];

export const entryCatalog: IEntryCatalogSection[] = [
    {
        key: "dock",
        label: lang("toggleDock"),
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
            node("close", lang("close")),
            node("delete", lang("delete")),
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
        children: [
            node("openDocument", lang("openDocument")),
            node("newDocAbove", lang("newDocAbove")),
            node("newDocBelow", lang("newDocBelow")),
            ...docTreeCommon(),
            node("rename", lang("rename")),
            node("attr", lang("attr")),
            node("search", lang("search")),
            node("replace", lang("replace")),
            node("fileHistory", lang("dataHistory")),
            node("import", lang("import"), true, importChildren()),
        ],
    },
    {
        key: "docTree.multi",
        label: location(lang("entryDocPanel"), lang("multiSelect"), lang("more")),
        children: docTreeCommon(true),
    },
    {
        key: "document.title",
        label: location(lang("editor"), lang("entryDocumentMenu")),
        children: [
            node("copy", lang("copy"), true, [...copyChildren(), node("copyMarkdown", lang("copyMarkdown")), node("copyDoc", lang("copyDoc"), false)]),
            node("move", lang("move")),
            node("addToDatabase", lang("addToDatabase"), false),
            node("delete", lang("delete")),
            node("outline", lang("outline")),
            node("backlinks", lang("backlinks")),
            node("graphView", lang("graphView")),
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
            node("openBy", lang("openBy")),
            node("openByNewWindow", lang("openByNewWindow")),
            node("showInFolder", lang("showInFolder")),
            node("fileHistory", lang("dataHistory")),
            node("export", lang("export"), true, exportChildren()),
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
            node("docInfo", lang("blockCount"), false),
        ],
    },
    {
        key: "gutter.single",
        label: location(lang("editor"), lang("entryGutterMenu"), lang("blockCount")),
        children: gutterCommon(),
    },
    {
        key: "gutter.multi",
        label: location(lang("editor"), lang("entryGutterMenu"), lang("multiSelect")),
        children: gutterCommon(),
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
            node("paste", lang("paste")),
            node("pasteAsPlainText", lang("pasteAsPlainText")),
            node("pasteEscaped", lang("pasteEscaped"), false),
            node("selectAll", lang("selectAll")),
            node("insertRowAbove", lang("insertRowAbove")),
            node("insertRowBelow", lang("insertRowBelow")),
            node("insertColumnLeft", lang("insertColumnLeft")),
            node("insertColumnRight", lang("insertColumnRight")),
            node("deleteRow", lang("delete-row")),
            node("deleteColumn", lang("delete-column")),
            node("more", lang("more"), true, [
                node("useDefaultWidth", lang("useDefaultWidth")),
                node("pinTableHead", lang("pinTableHead")),
                node("unpinTableHead", lang("unpinTableHead")),
                node("alignLeft", lang("alignLeft")),
                node("alignCenter", lang("alignCenter")),
                node("alignRight", lang("alignRight")),
                node("useDefaultAlign", lang("useDefaultAlign")),
                node("moveToUp", lang("moveToUp")),
                node("moveToDown", lang("moveToDown")),
                node("moveToLeft", lang("moveToLeft")),
                node("moveToRight", lang("moveToRight")),
            ]),
        ],
    },
    {
        key: "inline.image",
        label: location(lang("editor"), lang("entryInlineMenu"), lang("image")),
        children: [
            node("imageUrlAndTitleAndTooltipText", () => `${window.siyuan.languages.imageURL} / ${window.siyuan.languages.title} / ${window.siyuan.languages.tooltipText}`),
            node("copy", lang("copy")),
            node("copyImageURL", () => `${window.siyuan.languages.copy} ${window.siyuan.languages.imageURL}`),
            node("cut", lang("cut")),
            node("delete", lang("delete")),
            node("rename", lang("rename")),
            node("ocr", literal("OCR"), false, [
                node("ocrResult", lang("ocrResult"), false),
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
                node("widthDrag", lang("width")),
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
                node("heightDrag", lang("height")),
                node("default", lang("default")),
            ]),
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
            node("openBy", lang("openBy")),
            node("refTab", lang("refTab")),
            node("insertRight", lang("insertRight")),
            node("insertBottom", lang("insertBottom")),
            node("openByNewWindow", lang("openByNewWindow")),
            node("backlinks", lang("backlinks")),
            node("graphView", lang("graphView"), false),
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
            node("copy", lang("copy")),
            node("copyAHref", lang("copyAHref")),
            node("cut", lang("cut")),
            node("remove", lang("remove")),
            node("rename", lang("rename")),
            node("turnIntoRef", lang("ref")),
            node("turnIntoText", lang("text")),
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
            node("search", lang("search")),
            node("rename", lang("rename")),
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

const indexNodes = (prefix: string, nodes: IEntryCatalogNode[]) => {
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
export const getEntryPaths = () => Array.from(entryMap.keys());
