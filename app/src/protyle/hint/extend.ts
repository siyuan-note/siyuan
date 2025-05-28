import {fetchPost} from "../../util/fetch";
import {insertHTML} from "../util/insertHTML";
import {getIconByType} from "../../editor/getIcon";
import {updateHotkeyTip} from "../util/compatibility";
import {blockRender} from "../render/blockRender";
import {Constants} from "../../constants";
import {processRender} from "../util/processCode";
import {highlightRender} from "../render/highlightRender";
import {focusBlock, focusByRange, getEditorRange} from "../util/selection";
import {hasClosestBlock, hasClosestByClassName} from "../util/hasClosest";
import {getContenteditableElement, getTopAloneElement} from "../wysiwyg/getBlock";
import {replaceFileName} from "../../editor/rename";
import {transaction} from "../wysiwyg/transaction";
import {getAssetName, getDisplayName, pathPosix} from "../../util/pathName";
import {genEmptyElement} from "../../block/util";
import {updateListOrder} from "../wysiwyg/list";
import {escapeHtml} from "../../util/escape";
import {zoomOut} from "../../menus/protyle";
import {hideElements} from "../ui/hideElements";
import {genAssetHTML} from "../../asset/renderAssets";
import {unicode2Emoji} from "../../emoji";
import {avRender} from "../render/av/render";

const getHotkeyOrMarker = (hotkey: string, marker: string) => {
    if (hotkey) {
        return `<span class="b3-menu__accelerator">${updateHotkeyTip(hotkey)}</span>`;
    } else if (marker) {
        return `<span class="b3-list-item__meta">${marker}</span>`;
    }
    return "";
};

export const hintSlash = (key: string, protyle: IProtyle) => {
    const allList: IHintData[] = [{
        filter: [window.siyuan.languages.template, "template", "模板", "moban", "muban", "mb"],
        id: "template",
        value: Constants.ZWSP,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconMarkdown"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.template}</span></div>`,
    }, {
        filter: [window.siyuan.languages.widget, "widget", "挂件", "guajian", "gj"],
        id: "widget",
        value: Constants.ZWSP + 1,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconBoth"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.widget}</span></div>`,
    }, {
        filter: [window.siyuan.languages.assets, "assets", "资源", "ziyuan", "zy"],
        id: "assets",
        value: Constants.ZWSP + 2,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconImage"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.assets}</span></div>`,
    }, {
        filter: [window.siyuan.languages.ref, "block reference", "块引用", "kuaiyinyong", "kyy"],
        id: "ref",
        value: "((",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconRef"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.ref}</span><span class="b3-list-item__meta">((</span></div>`,
    }, {
        filter: [window.siyuan.languages.blockEmbed, "embed block", "嵌入块", "qianrukuai", "qrk"],
        id: "blockEmbed",
        value: "{{",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconSQL"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.blockEmbed}</span><span class="b3-list-item__meta">{{</span></div>`,
    }, {
        filter: [window.siyuan.languages.aiWriting, "ai writing", "ai编写", "aibianxie", "aibx", "人工智能", "rengongzhineng", "rgzn"],
        id: "aiWriting",
        value: Constants.ZWSP + 5,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconSparkles"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.aiWriting}</span>${getHotkeyOrMarker(window.siyuan.config.keymap.editor.general.aiWriting.custom, "")}</div>`,
    }, {
        filter: [window.siyuan.languages.database, "database", "db", "数据库", "shujuku", "sjk", "视图", "view"],
        id: "database",
        value: '<div data-type="NodeAttributeView" data-av-type="table"></div>',
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconDatabase"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.database}</span></div>`,
    }, {
        filter: [window.siyuan.languages.newFileRef, "create new doc with reference", "新建文档并引用", "xinjianwendangbingyinyong", "xjwdbyy"],
        id: "newFileRef",
        value: Constants.ZWSP + 4,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.newFileRef}</span></div>`,
    }, {
        filter: [window.siyuan.languages.newSubDocRef, "create sub doc with reference", "新建子文档并引用", "xinjianziwendangbingyinyong", "xjzwdbyy"],
        id: "newSubDocRef",
        value: Constants.ZWSP + 6,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.newSubDocRef}</span></div>`,
    }, {
        value: "",
        id: "separator_1",
        html: "separator",
    }, {
        filter: [window.siyuan.languages.heading1, "heading1", "h1", "一级标题", "yijibiaoti", "yjbt"],
        id: "heading1",
        value: "# " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconH1"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.heading1}</span>${getHotkeyOrMarker(window.siyuan.config.keymap.editor.heading.heading1.custom, "# ")}</div>`,
    }, {
        filter: [window.siyuan.languages.heading2, "heading2", "h2", "二级标题", "erjibiaoti", "ejbt"],
        id: "heading2",
        value: "## " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconH2"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.heading2}</span>${getHotkeyOrMarker(window.siyuan.config.keymap.editor.heading.heading2.custom, "## ")}</div>`,
    }, {
        filter: [window.siyuan.languages.heading3, "heading3", "h3", "三级标题", "sanjibiaoti", "sjbt"],
        id: "heading3",
        value: "### " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconH3"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.heading3}</span>${getHotkeyOrMarker(window.siyuan.config.keymap.editor.heading.heading3.custom, "### ")}</div>`,
    }, {
        filter: [window.siyuan.languages.heading4, "heading4", "h4", "四级标题", "sijibiaoti", "sjbt"],
        id: "heading4",
        value: "#### " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconH4"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.heading4}</span>${getHotkeyOrMarker(window.siyuan.config.keymap.editor.heading.heading4.custom, "#### ")}</div>`,
    }, {
        filter: [window.siyuan.languages.heading5, "heading5", "h5", "五级标题", "wujibiaoti", "wjbt"],
        id: "heading5",
        value: "##### " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconH5"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.heading5}</span>${getHotkeyOrMarker(window.siyuan.config.keymap.editor.heading.heading5.custom, "##### ")}</div>`,
    }, {
        filter: [window.siyuan.languages.heading6, "heading6", "h6", "六级标题", "liujibiaoti", "ljbt"],
        id: "heading6",
        value: "###### " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconH6"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.heading6}</span>${getHotkeyOrMarker(window.siyuan.config.keymap.editor.heading.heading6.custom, "###### ")}</div>`,
    }, {
        filter: [window.siyuan.languages.list, "unordered list", "无序列表", "wuxvliebiao", "wuxuliebiao", "wxlb"],
        id: "list",
        value: "* " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconList"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.list}</span>${getHotkeyOrMarker(window.siyuan.config.keymap.editor.insert.list.custom, "* ")}</div>`,
    }, {
        filter: [window.siyuan.languages["ordered-list"], "order list", "ordered list", "有序列表", "youxvliebiao", "youxuliebiao", "yxlb"],
        id: "orderedList",
        value: "1. " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconOrderedList"></use></svg><span class="b3-list-item__text">${window.siyuan.languages["ordered-list"]}</span>${getHotkeyOrMarker(window.siyuan.config.keymap.editor.insert["ordered-list"].custom, "1. ")}</div>`,
    }, {
        filter: [window.siyuan.languages.check, "task list", "todo list", "任务列表", "renwuliebiao", "rwlb"],
        id: "check",
        value: "* [ ] " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconCheck"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.check}</span>${getHotkeyOrMarker(window.siyuan.config.keymap.editor.insert.check.custom, "[]")}</div>`,
    }, {
        filter: [window.siyuan.languages.quote, "blockquote", "bq", "引述", "yinshu", "ys"],
        id: "quote",
        value: "> " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconQuote"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.quote}</span>${getHotkeyOrMarker(window.siyuan.config.keymap.editor.insert.quote.custom, ">")}</div>`,
    }, {
        filter: [window.siyuan.languages.code, "code block", "代码块", "daimakuai", "dmk"],
        id: "code",
        value: "```",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconCode"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.code}</span>${getHotkeyOrMarker(window.siyuan.config.keymap.editor.insert.code.custom, "```" + window.siyuan.languages.enterKey)}</div>`,
    }, {
        filter: [window.siyuan.languages.table, "table", "表格", "biaoge", "bg"],
        id: "table",
        value: `| ${Lute.Caret} |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |`,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconTable"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.table}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.table.custom))}</span></div>`,
    }, {
        filter: [window.siyuan.languages.line, "thematic break", "divider", "分隔线", "分割线", "fengexian", "fgx"],
        id: "line",
        value: "---",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconLine"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.line}</span><span class="b3-list-item__meta">---</span></div>`,
    }, {
        filter: [window.siyuan.languages.math, "formulas block", "math block", "数学公式块", "shuxuegongshikuai", "sxgsk"],
        id: "math",
        value: "$$",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconMath"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.math}</span><span class="b3-list-item__meta">$$</span></div>`,
    }, {
        filter: ["html"],
        id: "html",
        value: "<div>",
        html: '<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconHTML5"></use></svg><span class="b3-list-item__text">HTML</span></div>',
    }, {
        value: "",
        id: "separator_2",
        html: "separator",
    }, {
        filter: [window.siyuan.languages.emoji, "emoji", "表情", "biaoqing", "bq"],
        id: "emoji",
        value: "emoji",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconEmoji"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.emoji}</span><span class="b3-list-item__meta">:</span></div>`,
    }, {
        filter: [window.siyuan.languages.link, "link", "a", "链接", "lianjie", "lj"],
        id: "link",
        value: "a",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconLink"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.link}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.link.custom))}</span></div>`,
    }, {
        filter: [window.siyuan.languages.bold, "bold", "strong", "粗体", "cuti", "ct", "加粗", "jiacu", "jc"],
        id: "bold",
        value: "strong",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconBold"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.bold}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.bold.custom))}</span></div>`,
    }, {
        filter: [window.siyuan.languages.italic, "italic", "em", "斜体", "xieti", "xt"],
        id: "italic",
        value: "em",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconItalic"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.italic}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.italic.custom))}</span></div>`,
    }, {
        filter: [window.siyuan.languages.underline, "underline", "下划线", "xiahuaxian", "xhx"],
        id: "underline",
        value: "u",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconUnderline"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.underline}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.underline.custom))}</span></div>`,
    }, {
        filter: [window.siyuan.languages.strike, "strike", "delete", "删除线", "shanchuxian", "scx"],
        id: "strike",
        value: "s",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconStrike"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.strike}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.strike.custom))}</span></div>`,
    }, {
        filter: [window.siyuan.languages.mark, "mark", "标记", "biaoji", "bj", "高亮", "gaoliang", "gl"],
        id: "mark",
        value: "mark",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconMark"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.mark}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.mark.custom))}</span></div>`,
    }, {
        filter: [window.siyuan.languages.sup, "superscript", "上标", "shangbiao", "sb"],
        id: "sup",
        value: "sup",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconSup"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.sup}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.sup.custom))}</span></div>`,
    }, {
        filter: [window.siyuan.languages.sub, "subscript", "下标", "xiaobiao", "xb"],
        id: "sub",
        value: "sub",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconSub"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.sub}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.sub.custom))}</span></div>`,
    }, {
        filter: [window.siyuan.languages["inline-code"], "inline code", "行级代码", "hangjidaima", "hjdm"],
        id: "inlineCode",
        value: "code",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconInlineCode"></use></svg><span class="b3-list-item__text">${window.siyuan.languages["inline-code"]}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert["inline-code"].custom))}</span></div>`,
    }, {
        filter: [window.siyuan.languages.kbd, "kbd", "键盘", "jianpan", "jp"],
        id: "kbd",
        value: "kbd",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconKeymap"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.kbd}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.kbd.custom))}</span></div>`,
    }, {
        filter: [window.siyuan.languages.tag, "tags", "标签", "biaoqian", "bq"],
        id: "tag",
        value: "tag",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconTags"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.tag}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.tag.custom))}</span></div>`,
    }, {
        filter: [window.siyuan.languages["inline-math"], "inline formulas", "inline math", "行级公式", "hangjigongshi", "hjgs", "行级数学公式", "hangjishuxvegongshi", "hangjishuxuegongshi", "hjsxgs"],
        id: "inlineMath",
        value: "inline-math",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconMath"></use></svg><span class="b3-list-item__text">${window.siyuan.languages["inline-math"]}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert["inline-math"].custom))}</span></div>`,
    }, {
        value: "",
        id: "separator_3",
        html: "separator",
    }, {
        filter: [window.siyuan.languages.insertAsset, "insert image or file", "upload", "插入图片或文件", "charutupianhuowenjian", "crtphwj", "上传", "sc"],
        id: "insertAsset",
        value: Constants.ZWSP + 3,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconDownload"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.insertAsset}</span>
<input class="b3-form__upload" type="file" ${protyle.options.upload.accept ? 'multiple="' + protyle.options.upload.accept + '"' : ""}></div>`,
    }, {
        filter: [window.siyuan.languages.insertIframeURL, "insert iframe link", "插入 iframe 链接", "charuiframelianjie", "criframelj"],
        id: "insertIframeURL",
        value: '<iframe sandbox="allow-forms allow-presentation allow-same-origin allow-scripts allow-modals allow-popups" src="" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>',
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconLanguage"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.insertIframeURL}</span></div>`,
    }, {
        filter: [window.siyuan.languages.insertImgURL, "insert image link", "image", "img", "插入图片链接", "charutupianlianjie", "crtplj"],
        id: "insertImgURL",
        value: "![]()",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconImage"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.insertImgURL}</span></div>`,
    }, {
        filter: [window.siyuan.languages.insertVideoURL, "insert video link", "插入视频链接", "charushipinlianjie", "crsplj"],
        id: "insertVideoURL",
        value: '<video controls="controls" src=""></video>',
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconVideo"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.insertVideoURL}</span></div>`,
    }, {
        filter: [window.siyuan.languages.insertAudioURL, "insert audio link", "插入音频链接", "charuyinpinlianjie", "cryplj"],
        id: "insertAudioURL",
        value: '<audio controls="controls" src=""></audio>',
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconRecord"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.insertAudioURL}</span></div>`,
    }, {
        value: "",
        id: "separator_4",
        html: "separator",
    }, {
        filter: [window.siyuan.languages.staff, "staff", "五线谱", "wuxianpu", "wxp"],
        id: "staff",
        value: "```abc\n```",
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">ABC</span><span class="b3-list-item__meta">${window.siyuan.languages.staff}</span></div>`,
    }, {
        filter: [window.siyuan.languages.chart, "chart", "图表", "tubiao", "tb"],
        id: "chart",
        value: "```echarts\n```",
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">Chart</span><span class="b3-list-item__meta">${window.siyuan.languages.chart}</span></div>`,
    }, {
        filter: ["flowchart", "flow chart", "流程图", "liuchengtu", "lct"],
        id: "flowChart",
        value: "```flowchart\n```",
        html: '<div class="b3-list-item__first"><span class="b3-list-item__text">FlowChart</span><span class="b3-list-item__meta">Flow Chart</span></div>',
    }, {
        filter: ["graphviz", "状态图", "zhuangtaitu", "ztt"],
        id: "graph",
        value: "```graphviz\n```",
        html: '<div class="b3-list-item__first"><span class="b3-list-item__text">Graphviz</span><span class="b3-list-item__meta">Graph</span></div>',
    }, {
        filter: ["mermaid", "diagram", "图表", "tubiao", "tb"],
        id: "mermaid",
        value: "```mermaid\n```",
        html: '<div class="b3-list-item__first"><span class="b3-list-item__text">Mermaid</span><span class="b3-list-item__meta">Mermaid</span></div>',
    }, {
        filter: [window.siyuan.languages.mindmap, "mindmap", "脑图", "naotu", "nt"],
        id: "mindmap",
        value: "```mindmap\n```",
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">Mind map</span><span class="b3-list-item__meta">${window.siyuan.languages.mindmap}</span></div>`,
    }, {
        filter: ["plantuml", "建模语言", "jianmoyuyan", "jmyy"],
        id: "UML",
        value: "```plantuml\n```",
        html: '<div class="b3-list-item__first"><span class="b3-list-item__text">PlantUML</span><span class="b3-list-item__meta">UML</span></div>',
    }, {
        value: "",
        id: "separator_5",
        html: "separator",
    }, {
        filter: [window.siyuan.languages.infoStyle, "info style", "信息样式", "xinxiyangshi", "xxys"],
        id: "infoStyle",
        value: `style${Constants.ZWSP}color: var(--b3-card-info-color);background-color: var(--b3-card-info-background);`,
        html: `<div class="b3-list-item__first"><div style="color: var(--b3-card-info-color);background-color: var(--b3-card-info-background);" class="color__square color__square--list">A</div><span class="b3-list-item__text">${window.siyuan.languages.infoStyle}</span></div>`,
    }, {
        filter: [window.siyuan.languages.successStyle, "success style", "成功样式", "chenggongyangshi", "cgys"],
        id: "successStyle",
        value: `style${Constants.ZWSP}color: var(--b3-card-success-color);background-color: var(--b3-card-success-background);`,
        html: `<div class="b3-list-item__first"><div style="color: var(--b3-card-success-color);background-color: var(--b3-card-success-background);" class="color__square color__square--list">A</div><span class="b3-list-item__text">${window.siyuan.languages.successStyle}</span></div>`,
    }, {
        filter: [window.siyuan.languages.warningStyle, "warning style", "警告样式", "jinggaoyangshi", "jgys"],
        id: "warningStyle",
        value: `style${Constants.ZWSP}color: var(--b3-card-warning-color);background-color: var(--b3-card-warning-background);`,
        html: `<div class="b3-list-item__first"><div style="color: var(--b3-card-warning-color);background-color: var(--b3-card-warning-background);" class="color__square color__square--list">A</div><span class="b3-list-item__text">${window.siyuan.languages.warningStyle}</span></div>`,
    }, {
        filter: [window.siyuan.languages.errorStyle, "error style", "错误样式", "cuowuyangshi", "cwys"],
        id: "errorStyle",
        value: `style${Constants.ZWSP}color: var(--b3-card-error-color);background-color: var(--b3-card-error-background);`,
        html: `<div class="b3-list-item__first"><div style="color: var(--b3-card-error-color);background-color: var(--b3-card-error-background);" class="color__square color__square--list">A</div><span class="b3-list-item__text">${window.siyuan.languages.errorStyle}</span></div>`,
    }, {
        filter: [window.siyuan.languages.clearFontStyle, "clear style", "清除样式", "qingchuyangshi", "qcys"],
        id: "clearFontStyle",
        value: `style${Constants.ZWSP}`,
        html: `<div class="b3-list-item__first"><div class="color__square color__square--list">A</div><span class="b3-list-item__text">${window.siyuan.languages.clearFontStyle}</span></div>`,
    }, {
        value: "",
        id: "separator_6",
        html: "separator",
    }];
    let hasPlugin = false;
    protyle.app.plugins.forEach((plugin) => {
        plugin.protyleSlash.forEach(slash => {
            allList.push({
                filter: slash.filter,
                value: `plugin${Constants.ZWSP}${plugin.name}${Constants.ZWSP}${slash.id}`,
                html: slash.html
            });
            hasPlugin = true;
        });
    });
    if (!hasPlugin) {
        allList.pop();
    }
    if (key === "") {
        return allList;
    }
    return allList.filter((item) => {
        if (!item.filter) {
            return false;
        }
        const match = item.filter.find((filter) => {
            if (filter.toLowerCase().indexOf(key.toLowerCase()) > -1) {
                return true;
            }
        });
        if (match) {
            return true;
        } else {
            return false;
        }
    });
};

export const hintTag = (key: string, protyle: IProtyle): IHintData[] => {
    protyle.hint.genLoading(protyle);
    fetchPost("/api/search/searchTag", {
        k: key,
    }, (response) => {
        const dataList: IHintData[] = [];
        let hasKey = false;
        response.data.tags.forEach((item: string) => {
            const value = item.replace(/<mark>/g, "").replace(/<\/mark>/g, "");
            dataList.push({
                value: `<span data-type="tag">${value}</span>`,
                html: `<div class="b3-list-item__text">${item}</div>`,
            });
            if (value === response.data.k) {
                hasKey = true;
            }
        });
        if (response.data.k && !hasKey) {
            dataList.splice(0, 0, {
                value: `<span data-type="tag">${response.data.k}</span>`,
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
        attrHTML += `<span class="fn__flex"><svg class="b3-list-item__hinticon"><use xlink:href="#iconN"></use></svg><span>${item.name}</span></span><span class="fn__space"></span>`;
    }
    if (item.alias) {
        attrHTML += `<span class="fn__flex"><svg class="b3-list-item__hinticon"><use xlink:href="#iconA"></use></svg><span>${item.alias}</span></span><span class="fn__space"></span>`;
    }
    if (item.memo) {
        attrHTML += `<span class="fn__flex"><svg class="b3-list-item__hinticon"><use xlink:href="#iconM"></use></svg><span>${item.memo}</span></span>`;
    }
    if (attrHTML) {
        attrHTML = `<div class="fn__flex b3-list-item__meta b3-list-item__showall">${attrHTML}</div>`;
    }

    return `${attrHTML}<div class="b3-list-item__first">
    ${iconHTML}
    <span class="b3-list-item__text">${item.content}</span>
</div>
<div class="b3-list-item__meta b3-list-item__showall">${item.hPath}</div>`;
};

export const hintRef = (key: string, protyle: IProtyle, source: THintSource): IHintData[] => {
    const nodeElement = hasClosestBlock(getEditorRange(protyle.wysiwyg.element).startContainer);
    protyle.hint.genLoading(protyle);
    fetchPost("/api/search/searchRefBlock", {
        k: key,
        id: nodeElement ? nodeElement.getAttribute("data-node-id") : protyle.block.parentID,
        beforeLen: Math.floor((Math.max(protyle.element.clientWidth / 2, 320) - 58) / 28.8),
        rootID: source === "av" ? "" : protyle.block.rootID,
        isDatabase: source === "av",
        isSquareBrackets: ["[[", "【【"].includes(protyle.hint.splitChar)
    }, (response) => {
        const dataList: IHintData[] = [];
        if (response.data.newDoc) {
            const newFileName = Lute.UnEscapeHTMLStr(replaceFileName(response.data.k));
            dataList.push({
                value: `((newFile "${newFileName}"${Constants.ZWSP}'${newFileName}${Lute.Caret}'))`,
                html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg>
<span class="b3-list-item__text">${window.siyuan.languages.newFile} <mark>${response.data.k}</mark></span></div>`,
            });
        }
        response.data.blocks.forEach((item: IBlock) => {
            let value = `<span data-type="block-ref" data-id="${item.id}" data-subtype="d">${item.name || item.refText.replace(new RegExp(Constants.ZWSP, "g"), "")}</span>`;
            if (source === "search") {
                value = `<span data-type="block-ref" data-id="${item.id}" data-subtype="s">${key}${Constants.ZWSP}${item.name || item.refText.replace(new RegExp(Constants.ZWSP, "g"), "")}</span>`;
            } else if (source === "av") {
                let refText = item.name || item.refText.replace(new RegExp(Constants.ZWSP, "g"), "");
                if (nodeElement) {
                    refText = item.ial["custom-sy-av-s-text-" + nodeElement.getAttribute("data-av-id")] || refText;
                }
                value = `<span data-type="block-ref" data-id="${item.id}" data-subtype="s">${refText}</span>`;
            }
            dataList.push({
                value,
                html: genHintItemHTML(item),
            });
        });
        if (source === "search") {
            protyle.hint.splitChar = "((";
            protyle.hint.lastIndex = -1;
        }
        if (dataList.length === 0) {
            dataList.push({
                value: "",
                html: window.siyuan.languages.emptyContent,
            });
        } else if (response.data.newDoc && dataList.length > 1) {
            dataList[1].focus = true;
        }
        protyle.hint.genHTML(dataList, protyle, true, source);
    });
    return [];
};

export const hintEmbed = (key: string, protyle: IProtyle): IHintData[] => {
    if (key.endsWith("}}") || key.endsWith("」」")) {
        return [];
    }
    protyle.hint.genLoading(protyle);
    const nodeElement = hasClosestBlock(getEditorRange(protyle.wysiwyg.element).startContainer);
    fetchPost("/api/search/searchRefBlock", {
        k: key,
        isDatabase: false,
        beforeLen: Math.floor((Math.max(protyle.element.clientWidth / 2, 320) - 58) / 28.8),
        id: nodeElement ? nodeElement.getAttribute("data-node-id") : protyle.block.parentID,
        rootID: protyle.block.rootID,
    }, (response) => {
        const dataList: IHintData[] = [];
        response.data.blocks.forEach((item: IBlock) => {
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
    });
    return [];
};

export const hintRenderTemplate = (value: string, protyle: IProtyle, nodeElement: Element) => {
    fetchPost("/api/template/render", {
        id: protyle.block.parentID,
        path: value
    }, (response) => {
        focusByRange(protyle.toolbar.range);
        const editElement = getContenteditableElement(nodeElement);
        if (editElement && editElement.textContent.trim() === "") {
            insertHTML(response.data.content, protyle, true);
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
        avRender(protyle.wysiwyg.element, protyle);
        hideElements(["util"], protyle);
    });
};

export const hintRenderWidget = (value: string, protyle: IProtyle) => {
    focusByRange(protyle.toolbar.range);
    // src 地址以 / 结尾
    // Use the path ending with `/` when loading the widget https://github.com/siyuan-note/siyuan/issues/10520
    insertHTML(protyle.lute.SpinBlockDOM(`<iframe src="/widgets/${value}/" data-subtype="widget" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>`), protyle, true);
    hideElements(["util"], protyle);
};

export const hintRenderAssets = (value: string, protyle: IProtyle) => {
    focusByRange(protyle.toolbar.range);
    const type = pathPosix().extname(value).toLowerCase();
    const filename = value.startsWith("assets/") ? getAssetName(value) : value;
    insertHTML(genAssetHTML(type, value, filename, value.startsWith("assets/") ? filename + type : value), protyle);
    hideElements(["util"], protyle);
};

export const hintMoveBlock = (pathString: string, sourceElements: Element[], protyle: IProtyle) => {
    if (pathString === "/") {
        return;
    }
    const parentID = getDisplayName(pathString, true, true);
    if (protyle.block.rootID === parentID) {
        return;
    }
    const doOperations: IOperation[] = [];
    let topSourceElement: Element;
    const parentElement = sourceElements[0].parentElement;
    let sideElement;
    sourceElements.forEach((item, index) => {
        if (index === sourceElements.length - 1 &&
            // 动态加载过慢，导致 item 被移除
            item.parentElement) {
            topSourceElement = getTopAloneElement(item);
            sideElement = topSourceElement.nextElementSibling || topSourceElement.previousElementSibling;
            if (topSourceElement.isSameNode(item)) {
                topSourceElement = undefined;
            }
        }
        doOperations.push({
            action: "append",
            id: item.getAttribute("data-node-id"),
            parentID,
        });
        item.remove();
    });
    // 删除空元素
    if (topSourceElement) {
        doOperations.push({
            action: "delete",
            id: topSourceElement.getAttribute("data-node-id"),
        });
        topSourceElement.remove();
    } else if (parentElement.classList.contains("list") && parentElement.getAttribute("data-subtype") === "o" &&
        parentElement.childElementCount > 1) {
        updateListOrder(parentElement, 1);
        Array.from(parentElement.children).forEach((item) => {
            if (item.classList.contains("protyle-attr")) {
                return;
            }
            doOperations.push({
                action: "update",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML
            });
        });
    } else if (protyle.block.showAll && parentElement.classList.contains("protyle-wysiwyg") && parentElement.childElementCount === 0) {
        setTimeout(() => {
            zoomOut({protyle, id: protyle.block.parent2ID, focusId: protyle.block.parent2ID});
        }, Constants.TIMEOUT_INPUT * 2 + 100);
    } else if (parentElement.classList.contains("protyle-wysiwyg") && parentElement.innerHTML === "" &&
        !hasClosestByClassName(parentElement, "block__edit", true) &&
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
        parentElement.innerHTML = newElement.outerHTML;
        focusBlock(newElement);
    } else if (sideElement) {
        focusBlock(sideElement);
    }
    // 跨文档不支持撤销
    transaction(protyle, doOperations);
};
