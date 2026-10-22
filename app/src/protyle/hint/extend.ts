import {fetchPost} from "../../util/fetch";
import {registerBuiltinSlashHint} from "./builtinSlash";
import {canPickIOSPhotos} from "../upload/iosPhotos";
import {getSuperBlockCommand} from "../../block/superBlock";
import {insertHTML} from "../util/insertHTML";
import {TABLE_CELL_SLASH_IDS} from "../util/tableCellRichMenu";
import {getIconByType} from "../../editor/getIcon";
import {isDisabledFeature, updateHotkeyTip} from "../util/compatibility";
import {blockRender} from "../render/blockRender";
import {Constants} from "../../constants";
import {searchRef} from "./searchRef";
import {processRender} from "../util/processCode";
import {highlightRender} from "../render/highlightRender";
import {focusBlock, getEditorRange} from "../util/selection";
import {focusByRange} from "../util/selectionOffsets";
import {hasClosestBlock, hasClosestByClassName} from "../util/hasClosest";
import {
    getContenteditableElement,
    getNextBlock,
    getPreviousBlock,
    getSbChildBlockCount,
    getTopAloneElement
} from "../wysiwyg/getBlock";
import {transaction} from "../wysiwyg/transaction";
import {getAssetExtension, getAssetName, getDisplayName, isEncryptedBox} from "../../util/pathName";
import {cancelSB, genEmptyElement, rebalanceSbWidth, refreshSbResize} from "../../block/util";
import {getOrderedListStart, updateListOrder} from "../wysiwyg/list";
import {escapeHtml, escapeSearchHighlight, stripSearchMark} from "../../util/escape";
import {zoomOut} from "../../menus/protyle";
import {hideElements} from "../ui/hideElements";
import {genAssetHTML} from "../../asset/renderAssets";
import {unicode2Emoji} from "../../emoji";
import {addWidgetCacheVersion} from "../util/widgetCache";
import {
    getEntryCatalogNode,
    getPluginSlashEntryKey,
    getSlashMenuEntryPath,
    refreshSlashMenuCatalog,
    SLASH_MENU_ROOT_PATH,
} from "../../config/entryVisibility/catalog";
import {getConfiguredEntryVisibility, getEntryOrder} from "../../config/entryVisibility/runtime";
import {resolveSlashMenuItems, TSlashMenuItem} from "./slashMenu";
import {
    getBuiltinInlineStylePropertyValue,
    getBuiltinInlineStylePreview,
    isBuiltinInlineStyleVisible,
    TBuiltinInlineStyleID,
} from "../toolbar/inlineStyle";
import {confirmDialog} from "../../dialog/confirmDialog";
import {buildSemanticInlineHTML} from "../util/inlineElementMarker";
import {getHostCapabilities} from "../../util/hostCapabilities";
import {areProtylePluginExtensionsEnabled} from "../runtimeCapabilities";
import {
    getBlockSelectionModeElement,
    getBlockSelectionStatusIDs,
    getDeleteSelectionCandidate,
    setBlockSelectionModeElement
} from "../wysiwyg/blockSelection";
import {countBlockWord} from "../../layout/status";
import {genTemplateDocTreePlanHTML} from "../../template/docTree";
import {getDailyNoteHints} from "./dailyNote";

const slashBuiltinStyleIDs: Partial<Record<string, TBuiltinInlineStyleID>> = {
    infoStyle: "info",
    successStyle: "success",
    warningStyle: "warning",
    errorStyle: "error",
};

const getBuiltinStyleCSS = (id: TBuiltinInlineStyleID, preview = false) => {
    const colors = preview ? getBuiltinInlineStylePreview(id) : {
        color: getBuiltinInlineStylePropertyValue(id, "color"),
        backgroundColor: getBuiltinInlineStylePropertyValue(id, "backgroundColor"),
    };
    return `color: ${colors.color};background-color: ${colors.backgroundColor};`;
};

const getHotkeyAccelerator = (hotkey: string) =>
    `<span class="b3-menu__accelerator b3-menu__accelerator--hotkey">${updateHotkeyTip(hotkey)}</span>`;

const getHotkeyOrMarker = (hotkey: string, marker: string) => {
    if (hotkey) {
        return getHotkeyAccelerator(hotkey);
    } else if (marker) {
        return `<span class="b3-list-item__meta">${marker}</span>`;
    }
    return "";
};

// 斜杠菜单项的显示名称、图标和快捷键位统一在这里生成，避免逐项拼接相同的 HTML。
interface ISlashMenuEntry {
    filter: string[];         // 首项为本地化的显示名称，其余为搜索别名
    id: string;
    value: string;
    icon?: string;            // svg symbol id
    graphic?: string;         // 自定义图标 HTML，未指定 icon 时使用
    label?: string;           // 显示名称，默认为 filter[0]
    hotkey?: string;
    marker?: string;          // 未设置快捷键时显示的标记符
    keepHotkeySlot?: boolean; // 未设置快捷键时仍保留快捷键位
    suffix?: string;          // 显示名称后追加的 HTML，例如文件选择框
}

const genSlashMenuEntryHTML = (entry: ISlashMenuEntry) => {
    let accelerator = getHotkeyOrMarker(entry.hotkey || "", entry.marker || "");
    if (!accelerator && entry.keepHotkeySlot) {
        accelerator = getHotkeyAccelerator(entry.hotkey || "");
    }
    const graphic = entry.icon ? `<svg class="b3-list-item__graphic"><use xlink:href="#${entry.icon}"></use></svg>` :
        (entry.graphic || "");
    return `<div class="b3-list-item__first">${graphic}` +
        `<span class="b3-list-item__text">${entry.label ?? entry.filter[0]}</span>` +
        `${accelerator}${entry.suffix || ""}</div>`;
};

export const getBuiltinSlashMenuItems = (protyle: IProtyle): IHintData[] => {
    const items: Array<ISlashMenuEntry | IHintData> = [{
        filter: [window.siyuan.languages.template, "template", "模板", "moban", "muban", "mb"],
        id: "template",
        value: Constants.ZWSP,
        icon: "iconMarkdown",
    }, ...(getHostCapabilities().widgets ? [{
        filter: [window.siyuan.languages.widget, "widget", "挂件", "guajian", "gj"],
        id: "widget",
        value: Constants.ZWSP + 1,
        icon: "iconBoth",
    }] : []), {
        filter: [window.siyuan.languages.assets, "assets", "资源", "ziyuan", "zy"],
        id: "assets",
        value: Constants.ZWSP + 2,
        icon: "iconImage",
    }, {
        filter: [window.siyuan.languages.ref, "block reference", "块引用", "kuaiyinyong", "kyy"],
        id: "ref",
        value: "((",
        icon: "iconRef",
        marker: "((",
    }, {
        filter: [window.siyuan.languages.blockEmbed, "embed block", "嵌入块", "qianrukuai", "qrk"],
        id: "blockEmbed",
        value: "{{",
        icon: "iconSQL",
        marker: "{{",
    }, ...(isDisabledFeature("ai") ? [] : [{
        filter: [window.siyuan.languages.aiWriting, "ai writing", "ai编写", "aibianxie", "aibx", "人工智能", "rengongzhineng", "rgzn"],
        id: "aiWriting",
        value: Constants.ZWSP + 5,
        icon: "iconSparkles",
        hotkey: window.siyuan.config.keymap.editor.general.aiWriting.custom,
    }]), {
        filter: [window.siyuan.languages.database, "database", "db", "数据库", "shujuku", "sjk", "视图", "view"],
        id: "database",
        value: '<div data-type="NodeAttributeView" data-av-type="table"></div>',
        icon: "iconDatabase",
    }, {
        filter: [window.siyuan.languages.newFileRef, "create new doc with reference", "新建文档并引用", "xinjianwendangbingyinyong", "xjwdbyy"],
        id: "newFileRef",
        value: Constants.ZWSP + 4,
        icon: "iconFile",
    }, {
        filter: [window.siyuan.languages.newSubDocRef, "create sub doc with reference", "新建子文档并引用", "xinjianziwendangbingyinyong", "xjzwdbyy"],
        id: "newSubDocRef",
        value: Constants.ZWSP + 6,
        icon: "iconFile",
    }, {
        value: "",
        id: "separator_1",
        html: "separator",
    }, {
        filter: [window.siyuan.languages.heading1, "heading1", "h1", "一级标题", "yijibiaoti", "yjbt"],
        id: "heading1",
        value: "# " + Lute.Caret,
        icon: "iconH1",
        hotkey: window.siyuan.config.keymap.editor.heading.heading1.custom,
        marker: "# ",
    }, {
        filter: [window.siyuan.languages.heading2, "heading2", "h2", "二级标题", "erjibiaoti", "ejbt"],
        id: "heading2",
        value: "## " + Lute.Caret,
        icon: "iconH2",
        hotkey: window.siyuan.config.keymap.editor.heading.heading2.custom,
        marker: "## ",
    }, {
        filter: [window.siyuan.languages.heading3, "heading3", "h3", "三级标题", "sanjibiaoti", "sjbt"],
        id: "heading3",
        value: "### " + Lute.Caret,
        icon: "iconH3",
        hotkey: window.siyuan.config.keymap.editor.heading.heading3.custom,
        marker: "### ",
    }, {
        filter: [window.siyuan.languages.heading4, "heading4", "h4", "四级标题", "sijibiaoti", "sjbt"],
        id: "heading4",
        value: "#### " + Lute.Caret,
        icon: "iconH4",
        hotkey: window.siyuan.config.keymap.editor.heading.heading4.custom,
        marker: "#### ",
    }, {
        filter: [window.siyuan.languages.heading5, "heading5", "h5", "五级标题", "wujibiaoti", "wjbt"],
        id: "heading5",
        value: "##### " + Lute.Caret,
        icon: "iconH5",
        hotkey: window.siyuan.config.keymap.editor.heading.heading5.custom,
        marker: "##### ",
    }, {
        filter: [window.siyuan.languages.heading6, "heading6", "h6", "六级标题", "liujibiaoti", "ljbt"],
        id: "heading6",
        value: "###### " + Lute.Caret,
        icon: "iconH6",
        hotkey: window.siyuan.config.keymap.editor.heading.heading6.custom,
        marker: "###### ",
    }, {
        filter: [window.siyuan.languages.list, "unordered list", "无序列表", "wuxvliebiao", "wuxuliebiao", "wxlb"],
        id: "list",
        value: "- " + Lute.Caret,
        icon: "iconList",
        hotkey: window.siyuan.config.keymap.editor.insert.list.custom,
        marker: "- ",
    }, {
        filter: [window.siyuan.languages["ordered-list"], "order list", "ordered list", "有序列表", "youxvliebiao", "youxuliebiao", "yxlb"],
        id: "orderedList",
        value: "1. " + Lute.Caret,
        icon: "iconOrderedList",
        hotkey: window.siyuan.config.keymap.editor.insert["ordered-list"].custom,
        marker: "1. ",
    }, {
        filter: [window.siyuan.languages.check, "task list", "todo list", "任务列表", "renwuliebiao", "rwlb"],
        id: "check",
        value: "- [ ] " + Lute.Caret,
        icon: "iconCheck",
        hotkey: window.siyuan.config.keymap.editor.insert.check.custom,
        marker: "[]",
    }, {
        filter: [window.siyuan.languages.quote, "blockquote", "bq", "引述", "yinshu", "ys"],
        id: "quote",
        value: "> " + Lute.Caret,
        icon: "iconQuote",
        hotkey: window.siyuan.config.keymap.editor.insert.quote.custom,
        marker: ">",
    }, {
        filter: [window.siyuan.languages.horizontalSuperBlock, window.siyuan.languages.superBlock, "horizontal super block", "columns", "layout", "横向超级块", "hengxiangchaojikuai", "hx", "超级块", "chaojikuai", "cjk", "分栏", "fenlan", "fl"],
        id: "horizontalSuperBlock",
        value: getSuperBlockCommand("col"),
        icon: "iconSuper",
    }, {
        filter: [window.siyuan.languages.verticalSuperBlock, window.siyuan.languages.superBlock, "vertical super block", "columns", "layout", "纵向超级块", "zongxiangchaojikuai", "zx", "超级块", "chaojikuai", "cjk", "分栏", "fenlan", "fl"],
        id: "verticalSuperBlock",
        value: getSuperBlockCommand("row"),
        icon: "iconSuper",
    }, {
        filter: [window.siyuan.languages.tabs, "tabs", "页签", "yeqian", "yq"],
        id: "tabs",
        value: `::: tabs\n@tab\n\n${Lute.Caret}\n\n@tab\n\n:::\n`,
        icon: "iconTabs",
    }, {
        filter: [window.siyuan.languages.mindmap, "mindmap", "思维导图", "siweidaotu", "swdt", "脑图", "naotu", "nt"],
        id: "mindmap",
        value: `- ${Lute.Caret}\n{: ${Constants.CUSTOM_SY_LIST_MINDMAP}="1"}`,
        icon: "iconMindmap",
        hotkey: window.siyuan.config.keymap.editor.insert.mindmap?.custom,
    }, {
        filter: [window.siyuan.languages.callout, "callout", "ts", "提示", "tishi", "note"],
        id: "calloutNote",
        value: `> [!NOTE]\n> ${Lute.Caret}`,
        graphic: '<span class="b3-list-item__graphic">✏️</span>',
        label: `${window.siyuan.languages.callout} - <span style="color: var(--b3-callout-note)">Note</span>`,
        hotkey: window.siyuan.config.keymap.editor.insert.calloutNote?.custom,
    }, {
        filter: [window.siyuan.languages.callout, "callout", "ts", "提示", "tishi", "tip"],
        id: "calloutTip",
        value: `> [!TIP]\n> ${Lute.Caret}`,
        graphic: '<span class="b3-list-item__graphic">💡</span>',
        label: `${window.siyuan.languages.callout} - <span style="color: var(--b3-callout-tip)">Tip</span>`,
        hotkey: window.siyuan.config.keymap.editor.insert.calloutTip?.custom,
    }, {
        filter: [window.siyuan.languages.callout, "callout", "ts", "提示", "tishi", "important"],
        id: "calloutImportant",
        value: `> [!IMPORTANT]\n> ${Lute.Caret}`,
        graphic: '<span class="b3-list-item__graphic">❗</span>',
        label: `${window.siyuan.languages.callout} - <span style="color: var(--b3-callout-important)">Important</span>`,
        hotkey: window.siyuan.config.keymap.editor.insert.calloutImportant?.custom,
    }, {
        filter: [window.siyuan.languages.callout, "callout", "ts", "提示", "tishi", "warning"],
        id: "calloutWarning",
        value: `> [!WARNING]\n> ${Lute.Caret}`,
        graphic: '<span class="b3-list-item__graphic">⚠️</span>',
        label: `${window.siyuan.languages.callout} - <span style="color: var(--b3-callout-warning)">Warning</span>`,
        hotkey: window.siyuan.config.keymap.editor.insert.calloutWarning?.custom,
    }, {
        filter: [window.siyuan.languages.callout, "callout", "ts", "提示", "tishi", "caution"],
        id: "calloutCaution",
        value: `> [!CAUTION]\n> ${Lute.Caret}`,
        graphic: '<span class="b3-list-item__graphic">🚨</span>',
        label: `${window.siyuan.languages.callout} - <span style="color: var(--b3-callout-caution)">Caution</span>`,
        hotkey: window.siyuan.config.keymap.editor.insert.calloutCaution?.custom,
    }, {
        filter: [window.siyuan.languages.code, "code block", "代码块", "daimakuai", "dmk"],
        id: "code",
        value: "```",
        icon: "iconCode",
        hotkey: window.siyuan.config.keymap.editor.insert.code.custom,
        marker: "```" + window.siyuan.languages.enterKey,
    }, {
        filter: [window.siyuan.languages.table, "table", "表格", "biaoge", "bg"],
        id: "table",
        value: `| ${Lute.Caret} |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |`,
        icon: "iconTable",
        hotkey: window.siyuan.config.keymap.editor.insert.table.custom,
        keepHotkeySlot: true,
    }, {
        filter: [window.siyuan.languages.line, "thematic break", "divider", "分隔线", "分割线", "fengexian", "fgx"],
        id: "line",
        value: "---",
        icon: "iconLine",
        marker: "---",
    }, {
        filter: [window.siyuan.languages.math, "formulas block", "math block", "数学公式块", "shuxuegongshikuai", "sxgsk"],
        id: "math",
        value: "$$",
        icon: "iconMath",
        marker: "$$",
    }, {
        filter: ["html"],
        id: "html",
        value: "<div>",
        icon: "iconHTML5",
        label: "HTML",
    }, {
        filter: [window.siyuan.languages.databaseTableView, "database table view", "数据库表格视图", "shujukubiaogeshitu", "sjkbgs"],
        id: "databaseTableView",
        value: '<div data-type="NodeAttributeView" data-av-type="table"></div>',
        icon: "iconTable",
    }, {
        filter: [window.siyuan.languages.databaseListView, "database list view", "数据库列表视图", "shujukuliebiaoshitu", "sjklbs"],
        id: "databaseListView",
        value: '<div data-type="NodeAttributeView" data-av-type="list"></div>',
        icon: "iconList",
    }, {
        filter: [window.siyuan.languages.databaseGalleryView, "database card view", "database gallery view", "数据库卡片视图", "shujukukapianshitu", "sjkkps"],
        id: "databaseGalleryView",
        value: '<div data-type="NodeAttributeView" data-av-type="gallery"></div>',
        icon: "iconGallery",
    }, {
        filter: [window.siyuan.languages.databaseKanbanView, "database kanban view", "数据库看板视图", "shujukukanbanshitu", "sjkkbs"],
        id: "databaseKanbanView",
        value: '<div data-type="NodeAttributeView" data-av-type="kanban"></div>',
        icon: "iconBoard",
    }, {
        filter: [window.siyuan.languages.databaseCalendarView, "database calendar view", "日历", "rili"],
        id: "databaseCalendarView",
        value: '<div data-type="NodeAttributeView" data-av-type="calendar"></div>',
        icon: "iconCalendar",
    }, {
        value: "",
        id: "separator_2",
        html: "separator",
    }, {
        filter: [window.siyuan.languages.emoji, "emoji", "表情", "biaoqing", "bq"],
        id: "emoji",
        value: "emoji",
        icon: "iconEmoji",
        marker: ":",
    }, {
        filter: [window.siyuan.languages.link, "link", "a", "链接", "lianjie", "lj"],
        id: "link",
        value: "a",
        icon: "iconLink",
        hotkey: window.siyuan.config.keymap.editor.insert.link.custom,
        keepHotkeySlot: true,
    }, {
        filter: [window.siyuan.languages.bold, "bold", "strong", "粗体", "cuti", "ct", "加粗", "jiacu", "jc"],
        id: "bold",
        value: "strong",
        icon: "iconBold",
        hotkey: window.siyuan.config.keymap.editor.insert.bold.custom,
        keepHotkeySlot: true,
    }, {
        filter: [window.siyuan.languages.italic, "italic", "em", "斜体", "xieti", "xt"],
        id: "italic",
        value: "em",
        icon: "iconItalic",
        hotkey: window.siyuan.config.keymap.editor.insert.italic.custom,
        keepHotkeySlot: true,
    }, {
        filter: [window.siyuan.languages.underline, "underline", "下划线", "xiahuaxian", "xhx"],
        id: "underline",
        value: "u",
        icon: "iconUnderline",
        hotkey: window.siyuan.config.keymap.editor.insert.underline.custom,
        keepHotkeySlot: true,
    }, {
        filter: [window.siyuan.languages.strike, "strike", "delete", "删除线", "shanchuxian", "scx"],
        id: "strike",
        value: "s",
        icon: "iconStrike",
        hotkey: window.siyuan.config.keymap.editor.insert.strike.custom,
        keepHotkeySlot: true,
    }, {
        filter: [window.siyuan.languages.mark, "mark", "标记", "biaoji", "bj", "高亮", "gaoliang", "gl"],
        id: "mark",
        value: "mark",
        icon: "iconMark",
        hotkey: window.siyuan.config.keymap.editor.insert.mark.custom,
        keepHotkeySlot: true,
    }, {
        filter: [window.siyuan.languages.sup, "superscript", "上标", "shangbiao", "sb"],
        id: "sup",
        value: "sup",
        icon: "iconSup",
        hotkey: window.siyuan.config.keymap.editor.insert.sup.custom,
        keepHotkeySlot: true,
    }, {
        filter: [window.siyuan.languages.sub, "subscript", "下标", "xiaobiao", "xb"],
        id: "sub",
        value: "sub",
        icon: "iconSub",
        hotkey: window.siyuan.config.keymap.editor.insert.sub.custom,
        keepHotkeySlot: true,
    }, {
        filter: [window.siyuan.languages["inline-code"], "inline code", "行级代码", "hangjidaima", "hjdm"],
        id: "inlineCode",
        value: "code",
        icon: "iconInlineCode",
        hotkey: window.siyuan.config.keymap.editor.insert["inline-code"].custom,
        keepHotkeySlot: true,
    }, {
        filter: [window.siyuan.languages.kbd, "kbd", "键盘", "jianpan", "jp"],
        id: "kbd",
        value: "kbd",
        icon: "iconKeymap",
        hotkey: window.siyuan.config.keymap.editor.insert.kbd.custom,
        keepHotkeySlot: true,
    }, {
        filter: [window.siyuan.languages.tag, "tags", "标签", "biaoqian", "bq"],
        id: "tag",
        value: "tag",
        icon: "iconTag",
        hotkey: window.siyuan.config.keymap.editor.insert.tag.custom,
        keepHotkeySlot: true,
    }, {
        filter: [window.siyuan.languages["inline-math"], "inline formulas", "inline math", "行级公式", "hangjigongshi", "hjgs", "行级数学公式", "hangjishuxvegongshi", "hangjishuxuegongshi", "hjsxgs"],
        id: "inlineMath",
        value: "inline-math",
        icon: "iconMath",
        hotkey: window.siyuan.config.keymap.editor.insert["inline-math"].custom,
        keepHotkeySlot: true,
    }, {
        value: "",
        id: "separator_3",
        html: "separator",
    }, ...(canPickIOSPhotos() ? [{
        filter: [window.siyuan.languages.insertImage, window.siyuan.languages.livePhoto, "Live Photo", "Photos"],
        id: "insertIOSPhotos",
        value: Constants.ZWSP + 3,
        icon: "iconImage",
        suffix: '<input class="b3-form__upload" data-native-photos="true" type="file" accept="image/*" multiple="multiple">',
    }] : []), {
        filter: [window.siyuan.languages.insertAsset, "insert image or file", "upload", "插入图片或文件", "charutupianhuowenjian", "crtphwj", "上传", "sc"],
        id: "insertAsset",
        value: Constants.ZWSP + 3,
        icon: "iconUpload",
        suffix: `<input class="b3-form__upload" type="file" multiple="multiple"${protyle.options.upload.accept ?
            ` accept="${protyle.options.upload.accept}"` : ""}>`,
    }, ...(getHostCapabilities().localFileSystem ? [{
        filter: [window.siyuan.languages.insertHTMLFile, "embed html file", "iframe", "嵌入 html 文件", "qianruhtmlwenjian", "qrhtmlwj"],
        id: "insertHTMLFile",
        value: Constants.ZWSP + 3,
        icon: "iconHTML5",
        suffix: '<input class="b3-form__upload" data-upload-mode="html-iframe" type="file" multiple="multiple" accept=".html,.htm">',
    }] : []), ...(getHostCapabilities().remoteKernel ? [] : [{
        filter: [window.siyuan.languages.insertIframeURL, "insert iframe link", "插入 iframe 链接", "charuiframelianjie", "criframelj"],
        id: "insertIframeURL",
        value: '<iframe sandbox="allow-forms allow-presentation allow-same-origin allow-scripts allow-modals allow-popups allow-storage-access-by-user-activation" src="" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>',
        icon: "iconGlobe",
    }]), {
        filter: [window.siyuan.languages.insertImgURL, "insert image link", "image", "img", "插入图片链接", "charutupianlianjie", "crtplj"],
        id: "insertImgURL",
        value: "![]()",
        icon: "iconImage",
    }, {
        filter: [window.siyuan.languages.insertVideoURL, "insert video link", "插入视频链接", "charushipinlianjie", "crsplj"],
        id: "insertVideoURL",
        value: '<video controls="controls" src=""></video>',
        icon: "iconVideo",
    }, {
        filter: [window.siyuan.languages.insertAudioURL, "insert audio link", "插入音频链接", "charuyinpinlianjie", "cryplj"],
        id: "insertAudioURL",
        value: '<audio controls="controls" src=""></audio>',
        icon: "iconRecord",
    }, {
        value: "",
        id: "separator_4",
        html: "separator",
    }, {
        filter: [window.siyuan.languages.staff, "staff", "五线谱", "wuxianpu", "wxp"],
        id: "staff",
        value: "```abc\n```",
        label: "ABC",
        marker: window.siyuan.languages.staff,
    }, {
        filter: [window.siyuan.languages.chart, "chart", "图表", "tubiao", "tb"],
        id: "chart",
        value: "```echarts\n```",
        label: "Chart",
        marker: window.siyuan.languages.chart,
    }, {
        filter: ["flowchart", "flow chart", "流程图", "liuchengtu", "lct"],
        id: "flowChart",
        value: "```flowchart\n```",
        label: "FlowChart",
        marker: "Flow Chart",
    }, {
        filter: ["graphviz", "状态图", "zhuangtaitu", "ztt"],
        id: "graph",
        value: "```graphviz\n```",
        label: "Graphviz",
        marker: "Graph",
    }, {
        filter: ["mermaid", "diagram", "图表", "tubiao", "tb"],
        id: "mermaid",
        value: "```mermaid\n```",
        label: "Mermaid",
        marker: "Mermaid",
    }, {
        filter: ["plantuml", "建模语言", "jianmoyuyan", "jmyy"],
        id: "UML",
        value: "```plantuml\n```",
        label: "PlantUML",
        marker: "UML",
    }, {
        value: "",
        id: "separator_5",
        html: "separator",
    }, {
        filter: [window.siyuan.languages.infoStyle, "info style", "信息样式", "xinxiyangshi", "xxys"],
        id: "infoStyle",
        value: `style${Constants.ZWSP}${getBuiltinStyleCSS("info")}`,
        graphic: `<div style="${getBuiltinStyleCSS("info", true)}" class="color__square color__square--list">A</div>`,
    }, {
        filter: [window.siyuan.languages.successStyle, "success style", "成功样式", "chenggongyangshi", "cgys"],
        id: "successStyle",
        value: `style${Constants.ZWSP}${getBuiltinStyleCSS("success")}`,
        graphic: `<div style="${getBuiltinStyleCSS("success", true)}" class="color__square color__square--list">A</div>`,
    }, {
        filter: [window.siyuan.languages.warningStyle, "warning style", "警告样式", "jinggaoyangshi", "jgys"],
        id: "warningStyle",
        value: `style${Constants.ZWSP}${getBuiltinStyleCSS("warning")}`,
        graphic: `<div style="${getBuiltinStyleCSS("warning", true)}" class="color__square color__square--list">A</div>`,
    }, {
        filter: [window.siyuan.languages.errorStyle, "error style", "错误样式", "cuowuyangshi", "cwys"],
        id: "errorStyle",
        value: `style${Constants.ZWSP}${getBuiltinStyleCSS("error")}`,
        graphic: `<div style="${getBuiltinStyleCSS("error", true)}" class="color__square color__square--list">A</div>`,
    }, {
        filter: [window.siyuan.languages.clearFontStyle, "clear style", "清除样式", "qingchuyangshi", "qcys"],
        id: "clearFontStyle",
        value: `style${Constants.ZWSP}`,
        graphic: '<div class="color__square color__square--list">A</div>',
    }, {
        value: "",
        id: "separator_6",
        html: "separator",
    }];
    return items.map((item) => "html" in item ? item : {
        filter: item.filter,
        id: item.id,
        value: item.value,
        html: genSlashMenuEntryHTML(item),
    });
};

export const hintSlash = registerBuiltinSlashHint((key: string, protyle: IProtyle,
                                                 sourceOrHideConfiguredCreate: THintSource | boolean = false,
                                                 options: {visibilityRoot?: string} = {}) => {
    // 加号面板由用户主动打开，复用插入项配置但不受输入斜杠的提示开关影响。
    const visibilityRoot = options.visibilityRoot ||
        (protyle.hint.element.closest("#keyboardToolbar") ? SLASH_MENU_ROOT_PATH : undefined);
    const enabled = getConfiguredEntryVisibility(SLASH_MENU_ROOT_PATH, visibilityRoot);
    if (!enabled) {
        return [];
    }
    const hideConfiguredCreate = typeof sourceOrHideConfiguredCreate === "boolean" && sourceOrHideConfiguredCreate;
    const builtinList = getBuiltinSlashMenuItems(protyle);
    const allList = builtinList.map<TSlashMenuItem>((item) => ({
        ...item,
        entryKey: item.id || "",
        frequentEligible: key === "",
    }));
    let hasPlugin = false;
    if (areProtylePluginExtensionsEnabled(protyle)) {
        protyle.app.plugins.forEach((plugin) => {
            plugin.protyleSlash.forEach(slash => {
                allList.push({
                    filter: slash.filter,
                    showInLite: slash.showInLite,
                    id: slash.id,
                    entryKey: getPluginSlashEntryKey(plugin.name, slash.id,
                        slash.html === "separator" ? "separator" : "entry"),
                    frequentEligible: key === "",
                    value: `plugin${Constants.ZWSP}${plugin.name}${Constants.ZWSP}${slash.id}`,
                    html: slash.html
                });
                hasPlugin = true;
            });
        });
    }
    if (!hasPlugin) {
        allList.pop();
    }
    refreshSlashMenuCatalog(areProtylePluginExtensionsEnabled(protyle) ? protyle.app.plugins : []);
    const selection = getSelection();
    const focus = selection?.focusNode;
    const focusElement = focus instanceof Element ? focus : focus?.parentElement;
    const cell = focusElement?.closest("td, th");
    const inTableCell = cell && cell.closest(".protyle-wysiwyg") === protyle.wysiwyg.element;
    return resolveSlashMenuItems(allList.filter((item) => {
        const builtinStyleID = slashBuiltinStyleIDs[item.entryKey];
        return (!inTableCell || TABLE_CELL_SLASH_IDS.has(item.id)) &&
            getEntryCatalogNode(getSlashMenuEntryPath(item.entryKey)) &&
            (!builtinStyleID || isBuiltinInlineStyleVisible("style1", builtinStyleID));
    }), {
        enabled,
        hideConfiguredCreate,
        lite: protyle.lite,
        canUpload: !!(protyle.options.upload.handler || (protyle.options.upload.url && protyle.upload)),
        key,
        order: getEntryOrder(SLASH_MENU_ROOT_PATH),
        visible: (entryKey) => getConfiguredEntryVisibility(getSlashMenuEntryPath(entryKey), visibilityRoot),
    });
});

export const hintTag = (key: string, protyle: IProtyle): IHintData[] => {
    protyle.hint.genLoading(protyle);
    fetchPost("/api/search/searchTag", {
        k: key,
    }, (response) => {
        if (protyle.hint.element.classList.contains("fn__none")) {
            return;
        }
        const dataList: IHintData[] = [];
        let hasKey = false;
        response.data.tags.forEach((item: string) => {
            const value = item.replace(/<mark>/g, "").replace(/<\/mark>/g, "");
            dataList.push({
                value: buildSemanticInlineHTML("tag", value),
                html: `<div class="b3-list-item__text">${item}</div>`,
            });
            if (value === response.data.k) {
                hasKey = true;
            }
        });
        if (response.data.k && !hasKey) {
            dataList.splice(0, 0, {
                value: buildSemanticInlineHTML("tag", response.data.k),
                html: `<div class="b3-list-item__text">${window.siyuan.languages.newTag} <mark>${escapeHtml(response.data.k)}</mark></div>`,
            });
            if (dataList.length > 1) {
                dataList[1].focus = true;
            }
        }
        protyle.hint.genHTML(dataList, protyle, true, "hint");
    });

    return [];
};

export const genHintItemHTML = (item: IBlock) => {
    let iconHTML;
    if (item.type === "NodeDocument" && item.ial.icon) {
        iconHTML = unicode2Emoji(item.ial.icon, "b3-list-item__graphic popover__block", true);
        iconHTML = iconHTML.replace('popover__block"', `popover__block" data-id="${item.id}"`);
    } else {
        iconHTML = `<svg class="b3-list-item__graphic popover__block" data-id="${item.id}"><use xlink:href="#${getIconByType(item.type)}"></use></svg>`;
    }
    let attrHTML = "";
    if (item.name) {
        attrHTML += `<span class="fn__flex"><svg class="b3-list-item__hinticon"><use xlink:href="#iconN"></use></svg><span>${escapeSearchHighlight(item.name)}</span></span><span class="fn__space"></span>`;
    }
    if (item.alias) {
        attrHTML += `<span class="fn__flex"><svg class="b3-list-item__hinticon"><use xlink:href="#iconA"></use></svg><span>${escapeSearchHighlight(item.alias)}</span></span><span class="fn__space"></span>`;
    }
    if (item.memo) {
        attrHTML += `<span class="fn__flex"><svg class="b3-list-item__hinticon"><use xlink:href="#iconM"></use></svg><span>${escapeSearchHighlight(item.memo)}</span></span>`;
    }
    if (attrHTML) {
        attrHTML = `<div class="fn__flex b3-list-item__meta b3-list-item__showall">${attrHTML}</div>`;
    }
    let countHTML = "";
    if (item.refCount) {
        countHTML = `<span class="popover__block counter b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.ref}">${item.refCount}</span>`;
    }
    // data-node-id 用于获取引用面板
    return `${attrHTML}<div class="b3-list-item__first" data-node-id="${item.id}">
    ${iconHTML}
    <span class="b3-list-item__text">${item.content}</span>${countHTML}
</div>
<div class="b3-list-item__meta b3-list-item__showall">${item.hPath}</div>`;
};

export const hintRef = (key: string, protyle: IProtyle, source: THintSource): IHintData[] => {
    const nodeElement = hasClosestBlock((source === "av" ? protyle.toolbar.range :
        getEditorRange(protyle.wysiwyg.element)).startContainer);
    const createTarget = protyle.hint.prepareCreateTarget(protyle, "ref");
    protyle.hint.genLoading(protyle, 0, source);
    let refParam: import("../../types/api").SearchRefBlockRequestInput;
    if (protyle.lite) {
        refParam = {k: key, id: "", rootID: "", beforeLen: 48, isDatabase: false, isSquareBrackets: true};
        // 单元格内的临时块不在块树中，使用所属表格提供搜索和新建文档的上下文
        if (protyle.path && protyle.block.parentID) {
            refParam.id = protyle.block.parentID;
            refParam.rootID = protyle.block.rootID;
            refParam.isSquareBrackets = ["[[", "【【"].includes(protyle.hint.splitChar);
        }
    } else {
        refParam = {
            k: key,
            id: nodeElement ? nodeElement.getAttribute("data-node-id") : protyle.block.parentID,
            beforeLen: Math.floor((Math.max(protyle.element.clientWidth / 2, 320) - 58) / 28.8),
            rootID: source === "av" ? "" : protyle.block.rootID,
            isDatabase: source === "av",
            isSquareBrackets: ["[[", "【【"].includes(protyle.hint.splitChar)
        };
        if (isEncryptedBox(protyle.notebookId)) {
            refParam.notebook = protyle.notebookId;
        }
    }
    if (protyle.lite && isEncryptedBox(protyle.notebookId)) {
        refParam.notebook = protyle.notebookId;
    }
    // 自动闭合时输入对应闭合符直接完成引用
    const closeContext = source === "hint" && !protyle.lite && ["[[", "【【"].includes(protyle.hint.splitChar) && key.trim() !== "" &&
        protyle.hint.closeKeyTyped && window.siyuan.config.editor?.autoCloseRefBrackets &&
        protyle.hint.getRefCloseContext(protyle);
    if (closeContext) {
        refParam.exactDocTitle = true;
    }
    const dailyNotes = source === "hint" ? getDailyNoteHints(key, protyle).catch((): IHintData[] => []) : Promise.resolve([] as IHintData[]);
    searchRef(refParam).then((response) => {
        if (!response) {
            if (createTarget.isCurrent()) {
                protyle.hint.genHTML([], protyle, true, source);
            }
            return;
        }
        return Promise.all([createTarget.promise, dailyNotes]).then(([hideConfiguredCreate, dateHints]) => {
            if (!createTarget.isCurrent()) {
                return;
            }
            if (closeContext && !protyle.hint.isRefCloseContextCurrent(protyle, closeContext)) {
                protyle.hint.genHTML([], protyle, true, source);
                return;
            }
            const dataList: IHintData[] = [];
            let createItemCount = 0;
            dataList.push(...dateHints);
            createItemCount += dateHints.length;
            if (response.newDoc) {
                const newFileName = Lute.UnEscapeHTMLStr(response.k);
                if (!hideConfiguredCreate) {
                    dataList.push({
                        value: `((newFile "${newFileName}"${Constants.ZWSP}'${newFileName}${Lute.Caret}'))`,
                        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg>
<span class="b3-list-item__text">${window.siyuan.languages.newFile} <mark>${response.k}</mark></span></div>`,
                    });
                    createItemCount++;
                }
                dataList.push({
                    value: `((newSubDoc "${newFileName}"${Constants.ZWSP}'${newFileName}${Lute.Caret}'))`,
                    html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg>
<span class="b3-list-item__text">${window.siyuan.languages.newSubDoc} <mark>${response.k}</mark></span></div>`,
                });
                createItemCount++;
                dataList.push({
                    value: `((newFileAtPath "${newFileName}"${Constants.ZWSP}'${newFileName}${Lute.Caret}'))`,
                    html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFolder"></use></svg>
<span class="b3-list-item__text">${window.siyuan.languages.newFileAtPath} <mark>${response.k}</mark></span></div>`,
                });
                createItemCount++;
            }
            response.blocks.forEach((item: IBlock) => {
                const name = item.name ? stripSearchMark(escapeSearchHighlight(item.name)) : item.refText.replaceAll(Constants.ZWSP, "");
                let value = `<span data-type="block-ref" data-id="${item.id}" data-subtype="d">${name}</span>`;
                if (source === "search") {
                    value = `<span data-type="block-ref" data-id="${item.id}" data-subtype="s">${key}${Constants.ZWSP}${name}</span>`;
                } else if (source === "av") {
                    let refText = name;
                    if (nodeElement) {
                        refText = escapeHtml(item.ial[Constants.CUSTOM_SY_AV_STATIC_TEXT + nodeElement.getAttribute("data-av-id")] || "") || refText;
                    }
                    value = `<span data-type="block-ref" data-id="${item.id}" data-subtype="s">${refText}</span>`;
                }
                dataList.push({
                    value,
                    html: genHintItemHTML(item),
                });
            });
            if (closeContext) {
                // 依次选择标题完全一致的文档、日记、新建文档
                const commitItem = response.blocks.length > 0 ? dataList[createItemCount] :
                    (createItemCount > 0 ? dataList[0] : undefined);
                if (commitItem) {
                    protyle.hint.fillRefClose(commitItem.value, protyle, closeContext);
                    return;
                }
            }
            if (source === "search") {
                protyle.hint.splitChar = "((";
                protyle.hint.lastIndex = -1;
            }
            if (dataList.length === 0) {
                dataList.push({
                    value: "",
                    html: window.siyuan.languages.emptyContent,
                });
            } else if (createItemCount > 0 && dataList.length > createItemCount) {
                dataList[createItemCount].focus = true;
            }
            protyle.hint.genHTML(dataList, protyle, true, source);
        });
    }).catch(() => {
        if (createTarget.isCurrent()) {
            protyle.hint.genHTML([], protyle, true, source);
        }
    });
    return [];
};

export const hintEmbed = (key: string, protyle: IProtyle): IHintData[] => {
    if (key.endsWith("}}") || key.endsWith("」」")) {
        return [];
    }
    const isCurrent = protyle.hint.genLoading(protyle, 0, "hint");
    const nodeElement = hasClosestBlock(getEditorRange(protyle.wysiwyg.element).startContainer);
    const embedParam: import("../../types/api").SearchRefBlockRequestInput = {
        k: key,
        isDatabase: false,
        beforeLen: Math.floor((Math.max(protyle.element.clientWidth / 2, 320) - 58) / 28.8),
        id: nodeElement ? nodeElement.getAttribute("data-node-id") : protyle.block.parentID,
        rootID: protyle.block.rootID,
    };
    if (isEncryptedBox(protyle.notebookId)) {
        embedParam.notebook = protyle.notebookId;
    }
    searchRef(embedParam).then((response) => {
        if (!isCurrent()) {
            return;
        }
        if (!response) {
            protyle.hint.genHTML([], protyle, true, "hint");
            return;
        }
        const dataList: IHintData[] = [];
        response.blocks.forEach((item: IBlock) => {
            dataList.push({
                value: `{{select * from blocks where id='${item.id}'}}`,
                html: genHintItemHTML(item),
            });
        });
        if (dataList.length === 0) {
            dataList.push({
                value: "",
                html: window.siyuan.languages.emptyContent,
            });
        }
        protyle.hint.genHTML(dataList, protyle, true, "hint");
    }).catch(() => {
        if (isCurrent()) {
            protyle.hint.genHTML([], protyle, true, "hint");
        }
    });
    return [];
};

export const hintRenderTemplate = (value: string, protyle: IProtyle, nodeElement: Element) => {
    fetchPost("/api/template/render", {
        id: protyle.block.parentID,
        path: value,
        mode: "editorInsert"
    }, (response) => {
        const insertTemplate = (templateDocTreePlanID?: string) => {
            focusByRange(protyle.toolbar.range);
            const editElement = getContenteditableElement(nodeElement);
            if (templateDocTreePlanID || (editElement && editElement.textContent.trim() === "")) {
                insertHTML(response.data.content, protyle, true, false, false, undefined, undefined,
                    templateDocTreePlanID);
            } else {
                insertHTML(response.data.content, protyle);
            }
            // https://github.com/siyuan-note/siyuan/issues/4488
            protyle.wysiwyg.element.querySelectorAll('[status="temp"]').forEach(item => {
                item.remove();
            });
            blockRender(protyle, protyle.wysiwyg.element);
            processRender(protyle.wysiwyg.element);
            highlightRender(protyle.wysiwyg.element);
            hideElements(["util"], protyle);
        };
        const docTreePlan = response.data.docTreePlan;
        if (docTreePlan?.id) {
            hideElements(["util"], protyle);
            confirmDialog(window.siyuan.languages.template, genTemplateDocTreePlanHTML(docTreePlan, window.siyuan.languages.newSubDoc), () => {
                insertTemplate(docTreePlan.id);
            }, () => {
                focusByRange(protyle.toolbar.range);
            });
        } else {
            insertTemplate();
        }
    });
};

export const hintRenderWidget = (value: string, protyle: IProtyle) => {
    if (!getHostCapabilities().widgets) {
        return;
    }
    focusByRange(protyle.toolbar.range);
    // src 地址以 / 结尾
    // Use the path ending with `/` when loading the widget https://github.com/siyuan-note/siyuan/issues/10520
    const src = addWidgetCacheVersion(`/widgets/${value}/`, Constants.SIYUAN_VERSION);
    insertHTML(protyle.lute.SpinBlockDOM(`<iframe src="${src}" data-subtype="widget" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>`), protyle, true);
    hideElements(["util"], protyle);
};

export const hintRenderAssets = (value: string, protyle: IProtyle) => {
    focusByRange(protyle.toolbar.range);
    const type = getAssetExtension(value).toLowerCase();
    const filename = value.startsWith("assets/") ? getAssetName(value) : value;
    insertHTML(genAssetHTML(type, value, filename, value.startsWith("assets/") ? filename + type : value), protyle);
    hideElements(["util"], protyle);
};

export const hintMoveBlock = async (pathString: string, sourceElements: Element[], protyle: IProtyle) => {
    if (pathString === "/") {
        return;
    }
    const parentID = getDisplayName(pathString, true, true);
    if (protyle.block.rootID === parentID) {
        return;
    }
    const doOperations: IOperation[] = [];
    const selectionModeElement = getBlockSelectionModeElement(protyle.wysiwyg.element);
    const sourceParents = new Map<Element, number | undefined>();
    const sourceSuperBlocks = new Map<Element, Set<string>>();
    sourceElements.forEach(item => {
        if (item.parentElement && !sourceParents.has(item.parentElement)) {
            sourceParents.set(item.parentElement, getOrderedListStart(item.parentElement));
        }
    });
    const candidateElements = Array.from(new Set(sourceElements.filter(item => item.parentElement)
        .map(item => getTopAloneElement(item))));
    const sideElement = getDeleteSelectionCandidate(candidateElements, "remove",
        getPreviousBlock, getNextBlock)?.element;
    sourceElements.forEach((item) => {
        let topSourceElement: Element;
        // 动态加载过慢时 item 可能已被移除，此时仍提交移动操作，但不再处理本地容器。
        if (item.parentElement) {
            const topElement = getTopAloneElement(item);
            if (topElement.parentElement?.getAttribute("data-type") === "NodeSuperBlock") {
                if (!sourceSuperBlocks.has(topElement.parentElement)) {
                    sourceSuperBlocks.set(topElement.parentElement, new Set());
                }
                sourceSuperBlocks.get(topElement.parentElement).add(topElement.getAttribute("data-node-id"));
            }
            if (topElement !== item) {
                topSourceElement = topElement;
            }
        }
        doOperations.push({
            action: "append",
            id: item.getAttribute("data-node-id"),
            parentID,
        });
        item.remove();
        if (topSourceElement) {
            doOperations.push({
                action: "delete",
                id: topSourceElement.getAttribute("data-node-id"),
            });
            topSourceElement.remove();
        }
    });
    sourceParents.forEach((listStart, sourceParent) => {
        if (!sourceParent.isConnected || !sourceParent.classList.contains("list") ||
            sourceParent.getAttribute("data-subtype") !== "o" || sourceParent.childElementCount <= 1) {
            return;
        }
        updateListOrder(sourceParent, listStart);
        Array.from(sourceParent.children).forEach((item) => {
            if (item.classList.contains("protyle-attr")) {
                return;
            }
            item.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
            doOperations.push({
                action: "update",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML
            });
        });
    });
    const getElementDepth = (element: Element) => {
        let depth = 0;
        let parentElement = element.parentElement;
        while (parentElement) {
            depth++;
            parentElement = parentElement.parentElement;
        }
        return depth;
    };
    const childReplacements = new Map<string, {
        childIDs: string[],
        foldedHeadingIDs: string[]
    }>();
    const sortedSuperBlocks = Array.from(sourceSuperBlocks.entries())
        .sort(([first], [second]) => getElementDepth(second) - getElementDepth(first));
    for (const [superBlock, excludedChildIDs] of sortedSuperBlocks) {
        if (!superBlock.isConnected) {
            continue;
        }
        if (getSbChildBlockCount(superBlock) === 1) {
            const cancelOperations = await cancelSB(protyle, superBlock, undefined, excludedChildIDs,
                childReplacements);
            doOperations.push(...cancelOperations.doOperations);
            if (cancelOperations.doOperations.length > 0) {
                childReplacements.set(superBlock.getAttribute("data-node-id"), {
                    childIDs: cancelOperations.childIDs || [],
                    foldedHeadingIDs: cancelOperations.foldedHeadingIDs || [],
                });
            }
        } else {
            refreshSbResize(superBlock);
            rebalanceSbWidth(superBlock).forEach(change => {
                const targetElement = superBlock.querySelector(`[data-node-id="${change.id}"]`);
                if (targetElement) {
                    doOperations.push({
                        action: "setAttrs",
                        id: change.id,
                        data: JSON.stringify({style: targetElement.getAttribute("style") || ""})
                    });
                }
            });
        }
    }
    const editorElement = protyle.wysiwyg.element;
    if (protyle.block.showAll && editorElement.childElementCount === 0) {
        const focusID = protyle.block.parent2ID;
        setTimeout(() => {
            if (!document.contains(protyle.element) || editorElement.childElementCount > 0) {
                return;
            }
            zoomOut({
                protyle,
                id: focusID,
                focusId: focusID,
                callback: selectionModeElement ? () => {
                    const targetElement = editorElement.querySelector<HTMLElement>(`[data-node-id="${focusID}"]`) ||
                        editorElement.querySelector<HTMLElement>("[data-node-id]");
                    if (targetElement) {
                        setBlockSelectionModeElement(editorElement, targetElement);
                        focusBlock(targetElement);
                        countBlockWord(getBlockSelectionStatusIDs(editorElement), protyle);
                    }
                } : undefined,
            });
        }, Constants.TIMEOUT_INPUT * 2 + 100);
    } else if (editorElement.innerHTML === "" &&
        !hasClosestByClassName(editorElement, "block__edit", true) &&
        protyle.block.id === protyle.block.rootID) {
        // 根文档原内容为空
        const newId = Lute.NewNodeID();
        const newElement = genEmptyElement(false, false, newId);
        doOperations.splice(0, 0, {
            action: "insert",
            id: newId,
            data: newElement.outerHTML,
            parentID: protyle.block.parentID
        });
        editorElement.innerHTML = newElement.outerHTML;
        if (!selectionModeElement) {
            focusBlock(editorElement.firstElementChild);
        }
    } else if (sideElement?.isConnected && editorElement.contains(sideElement) &&
        sideElement.getAttribute("data-node-id")) {
        if (!selectionModeElement) {
            focusBlock(sideElement);
        }
    }
    if (selectionModeElement) {
        let nextSelectionModeElement: Element;
        const isValidSelectionModeElement = (element?: Element) => !!element && element.isConnected &&
            editorElement.contains(element) && !!element.getAttribute("data-node-id");
        if (isValidSelectionModeElement(selectionModeElement)) {
            nextSelectionModeElement = selectionModeElement;
        } else if (isValidSelectionModeElement(sideElement)) {
            nextSelectionModeElement = sideElement;
        } else {
            nextSelectionModeElement = editorElement.querySelector<HTMLElement>("[data-node-id]");
        }
        if (nextSelectionModeElement) {
            setBlockSelectionModeElement(editorElement, nextSelectionModeElement);
            focusBlock(nextSelectionModeElement);
            countBlockWord(getBlockSelectionStatusIDs(editorElement), protyle);
        }
    }
    // 跨文档不支持撤销
    transaction(protyle, doOperations);
};
