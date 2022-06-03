import {fetchPost} from "../../util/fetch";
import {insertHTML} from "../util/insertHTML";
import {getIconByType} from "../../editor/getIcon";
import {updateHotkeyTip} from "../util/compatibility";
import {blockRender} from "../markdown/blockRender";
import {Constants} from "../../constants";
import {processRender} from "../util/processCode";
import {highlightRender} from "../markdown/highlightRender";
import {focusBlock, focusByRange, getEditorRange} from "../util/selection";
import {hasClosestBlock, hasClosestByClassName} from "../util/hasClosest";
import {getContenteditableElement, getTopAloneElement} from "../wysiwyg/getBlock";
import {replaceFileName} from "../../editor/rename";
import {transaction} from "../wysiwyg/transaction";
import {getDisplayName} from "../../util/pathName";
import {genEmptyElement} from "../../block/util";
import {updateListOrder} from "../wysiwyg/list";
import {escapeHtml} from "../../util/escape";
import {zoomOut} from "../../menus/protyle";

export const hintSlash = (key: string, protyle: IProtyle) => {
    const allList: IHintData[] = [{
        filter: ["模版", "moban", "mb", "template"],
        value: Constants.ZWSP,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic ft__error"><use xlink:href="#iconMarkdown"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.template}</span></div>`,
    }, {
        filter: ["资源", "assets", "zy", "ziyuan"],
        value: Constants.ZWSP + 2,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconImage"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.assets}</span></div>`,
    }, {
        filter: ["引用块", "yinyong", "yy", "block reference"],
        value: "((",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconGraph"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.blockRef}</span><span class="b3-list-item__meta">((</span></div>`,
    }, {
        filter: ["嵌入块", "qianrukuai", "qrk", "embed block"],
        value: "{{",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconSQL"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.blockEmbed}</span><span class="b3-list-item__meta">{{</span></div>`,
    }, {
        filter: ["文档", "子文档", "wendang", "wd", "ziwendang", "zwd", "xjwd"],
        value: Constants.ZWSP + 4,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.newFile}</span></div>`,
    }, {
        value: "",
        html: "separator",
    }, {
        filter: ["yijibiaoti", "一级标题", "yjbt", "h1", "heading"],
        value: "# " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconH1"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.heading1}</span><span class="b3-menu__accelerator">${updateHotkeyTip(window.siyuan.config.keymap.editor.heading.heading1.custom)}</span></div>`,
    }, {
        filter: ["erjibiaoti", "二级标题", "ejbt", "h2", "heading"],
        value: "## " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconH2"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.heading2}</span><span class="b3-menu__accelerator">${updateHotkeyTip(window.siyuan.config.keymap.editor.heading.heading2.custom)}</span></div>`,
    }, {
        filter: ["sanjibiaoti", "三级标题", "sjbt", "h3", "heading"],
        value: "### " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconH3"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.heading3}</span><span class="b3-menu__accelerator">${updateHotkeyTip(window.siyuan.config.keymap.editor.heading.heading3.custom)}</span></div>`,
    }, {
        filter: ["sijibiaoti", "四级标题", "sjbt", "h4", "heading"],
        value: "#### " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconH4"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.heading4}</span><span class="b3-menu__accelerator">${updateHotkeyTip(window.siyuan.config.keymap.editor.heading.heading4.custom)}</span></div>`,
    }, {
        filter: ["wujibiaoti", "五级标题", "wjbt", "h5", "heading"],
        value: "##### " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconH5"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.heading5}</span><span class="b3-menu__accelerator">${updateHotkeyTip(window.siyuan.config.keymap.editor.heading.heading5.custom)}</span></div>`,
    }, {
        filter: ["liujibiaoti", "六级标题", "ljbt", "h6", "heading"],
        value: "###### " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconH6"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.heading6}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.heading.heading6.custom))}</span></div>`,
    }, {
        filter: ["无序列表", "wuxuliebiao", "wxlb", "unordered list"],
        value: "* " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconList"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.list}</span><span class="b3-menu__accelerator">*&nbsp;</span></div>`,
    }, {
        filter: ["有序列表", "youxuliebiao", "yxlb", "ordered list"],
        value: "1. " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconOrderedList"></use></svg><span class="b3-list-item__text">${window.siyuan.languages["ordered-list"]}</span><span class="b3-menu__accelerator">1.&nbsp;</span></div>`,
    }, {
        filter: ["任务列表", "renwuliebiao", "rwlb", "task list", "todo list"],
        value: "* [ ] " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconCheck"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.check}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.check.custom))}</span></div>`,
    }, {
        filter: ["引述", "yinshu", "ys", "bq", "blockquote"],
        value: "> " + Lute.Caret,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconQuote"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.quote}</span><span class="b3-menu__accelerator">&gt;</span></div>`,
    }, {
        filter: ["代码块", "daimakuai", "dmk", "code block"],
        value: "```",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconCode"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.code}</span><span class="b3-menu__accelerator">\`\`\`Enter</span></div>`,
    }, {
        filter: ["表格", "biaoge", "bg", "table"],
        value: `| col1${Lute.Caret} | col2 | col3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |`,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconTable"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.table}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.table.custom))}</span></div>`,
    }, {
        filter: ["分割线", "fengexian", "fgx", "divider"],
        value: "---",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconLine"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.line}</span><span class="b3-menu__accelerator">---</span></div>`,
    }, {
        filter: ["数学公式块", "shuxuegongshikuai", "sxgsk", "math block"],
        value: "$$",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconMath"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.math}</span><span class="b3-list-item__meta">$$</span></div>`,
    }, {
        filter: ["html"],
        value: "<div>",
        html: '<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconHTML5"></use></svg><span class="b3-list-item__text">HTML</span></div>',
    }, {
        value: "",
        html: "separator",
    }, {
        filter: ["表情", "biaoqing", "bq", "emoji"],
        value: "emoji",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconEmoji"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.emoji}</span><span class="b3-menu__accelerator">:</span></div>`,
    }, {
        filter: ["链接", "lianjie", "lj", "link"],
        value: "link",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconLink"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.link}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.link.custom))}</span></div>`,
    }, {
        filter: ["粗体", "cuti", "ct", "bold"],
        value: "bold",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconBold"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.bold}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.bold.custom))}</span></div>`,
    }, {
        filter: ["斜体", "xieti", "xt", "italic"],
        value: "italic",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconItalic"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.italic}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.italic.custom))}</span></div>`,
    }, {
        filter: ["下划线", "xiahuaxian", "xhx", "underline"],
        value: "underline",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconUnderline"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.underline}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.underline.custom))}</span></div>`,
    }, {
        filter: ["删除线", "shanchuxian", "scx", "strike"],
        value: "strike",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconStrike"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.strike}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.strike.custom))}</span></div>`,
    }, {
        filter: ["标记", "biaoji", "bj", "mark"],
        value: "mark",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconMark"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.mark}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.mark.custom))}</span></div>`,
    }, {
        filter: ["上标", "shangbiao", "sb", "superscript"],
        value: "sup",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconSup"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.sup}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.sup.custom))}</span></div>`,
    }, {
        filter: ["下标", "xiaobiao", "xb", "subscript"],
        value: "sub",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconSub"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.sub}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.sub.custom))}</span></div>`,
    }, {
        filter: ["标签", "biaoqian", "bq", "tag"],
        value: "tag",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconTags"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.tag}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert.tag.custom))}</span></div>`,
    }, {
        filter: ["行内代码", "hangneidaima", "hndm", "inline code"],
        value: "inline-code",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconInlineCode"></use></svg><span class="b3-list-item__text">${window.siyuan.languages["inline-code"]}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert["inline-code"].custom))}</span></div>`,
    }, {
        filter: ["行内数学公式", "hangneishuxuegongshi", "hnsxgs", "inline math"],
        value: "inline-math",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconMath"></use></svg><span class="b3-list-item__text">${window.siyuan.languages["inline-math"]}</span><span class="b3-menu__accelerator">${updateHotkeyTip((window.siyuan.config.keymap.editor.insert["inline-math"].custom))}</span></div>`,
    }, {
        value: "",
        html: "separator",
    }, {
        filter: ["插入图片或文件", "upload", "上传", "crtphwj", "sc"],
        value: Constants.ZWSP + 3,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconDownload"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.insertAsset}</span>
<input class="b3-form__upload" type="file" ${protyle.options.upload.accept ? 'multiple="' + protyle.options.upload.accept + '"' : ""}></div>`,
    }, {
        filter: ["iframe", "嵌入网址", "qianruwangzhan", "qrwz"],
        value: '<iframe src="" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>',
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconLanguage"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.insertIframeURL}</span></div>`,
    }, {
        filter: ["输入图片链接", "input image url", "shurutupianlianjie", "srtptp"],
        value: "![]()",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconImage"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.insertImgURL}</span></div>`,
    }, {
        filter: ["输入视频链接", "shurushipinlianjie", "srsplj", "input video url"],
        value: '<video controls="controls" src=""></video>',
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconVideo"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.insertVideoURL}</span></div>`,
    }, {
        filter: ["输入音频链接", "shuruyinpinlianjie", "sryplj", "input audio url"],
        value: '<audio controls="controls" src=""></audio>',
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconRecord"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.insertAudioURL}</span></div>`,
    }, {
        value: "",
        html: "separator",
    }, {
        filter: ["五线谱", "wuxianpu", "wxp", "staff"],
        value: "```abc\n```",
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">ABC</span><span class="b3-list-item__meta">${window.siyuan.languages.staff}</span></div>`,
    }, {
        filter: ["图表", "tubiao", "tb", "chart"],
        value: "```echarts\n```",
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">Chart</span><span class="b3-list-item__meta">${window.siyuan.languages.chart}</span></div>`,
    }, {
        filter: ["流程图", "liuchengtu", "lct", "flow chart"],
        value: "```flowchart\n```",
        html: '<div class="b3-list-item__first"><span class="b3-list-item__text">FlowChart</span><span class="b3-list-item__meta">Flow Chart</span></div>',
    }, {
        filter: ["状态图", "zhuangtaitu", "ztt", "graph viz"],
        value: "```graphviz\n```",
        html: '<div class="b3-list-item__first"><span class="b3-list-item__text">Graphviz</span><span class="b3-list-item__meta">Graph</span></div>',
    }, {
        filter: ["流程图", "时序图", "甘特图", "liuchengtu", "shixutu", "gantetu", "lct", "sxt", "gtt", "mermaid"],
        value: "```mermaid\n```",
        html: '<div class="b3-list-item__first"><span class="b3-list-item__text">Mermaid</span><span class="b3-list-item__meta">Mermaid</span></div>',
    }, {
        filter: ["脑图", "naotu", "nt", "mind map"],
        value: "```mindmap\n```",
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">Mind map</span><span class="b3-list-item__meta">${window.siyuan.languages.mindmap}</span></div>`,
    }, {
        filter: ["统一建模语言", "tongyijianmoyuyan", "tyjmyy", "plant uml"],
        value: "```plantuml\n```",
        html: '<div class="b3-list-item__first"><span class="b3-list-item__text">PlantUML</span><span class="b3-list-item__meta">UML</span></div>',
    }, {
        value: "",
        html: "separator",
    }, {
        filter: ["信息样式", "xinxiyangshi", "xxys", "info style"],
        value: `style${Constants.ZWSP}color: var(--b3-card-info-color);background-color: var(--b3-card-info-background);`,
        html: `<div class="b3-list-item__first"><div style="color: var(--b3-card-info-color);background-color: var(--b3-card-info-background);" class="b3-color__square">A</div><span class="b3-list-item__text">${window.siyuan.languages.infoStyle}</span></div>`,
    }, {
        filter: ["成功样式", "chenggongyangshi", "cgys", "success style"],
        value: `style${Constants.ZWSP}color: var(--b3-card-success-color);background-color: var(--b3-card-success-background);`,
        html: `<div class="b3-list-item__first"><div style="color: var(--b3-card-success-color);background-color: var(--b3-card-success-background);" class="b3-color__square">A</div><span class="b3-list-item__text">${window.siyuan.languages.successStyle}</span></div>`,
    }, {
        filter: ["警告样式", "jinggaoyangshi", "jgys", "warning style"],
        value: `style${Constants.ZWSP}color: var(--b3-card-warning-color);background-color: var(--b3-card-warning-background);`,
        html: `<div class="b3-list-item__first"><div style="color: var(--b3-card-warning-color);background-color: var(--b3-card-warning-background);" class="b3-color__square">A</div><span class="b3-list-item__text">${window.siyuan.languages.warningStyle}</span></div>`,
    }, {
        filter: ["错误样式", "cuowuyangshi", "cwys", "error style"],
        value: `style${Constants.ZWSP}color: var(--b3-card-error-color);background-color: var(--b3-card-error-background);`,
        html: `<div class="b3-list-item__first"><div style="color: var(--b3-card-error-color);background-color: var(--b3-card-error-background);" class="b3-color__square">A</div><span class="b3-list-item__text">${window.siyuan.languages.errorStyle}</span></div>`,
    }, {
        filter: ["移除样式", "yichuyangshi", "ycys", "remove style"],
        value: `style${Constants.ZWSP}`,
        html: `<div class="b3-list-item__first"><div class="b3-color__square">A</div><span class="b3-list-item__text">${window.siyuan.languages.clearFontStyle}</span></div>`,
    }];
    allList.splice(1, 0, {
        filter: ["挂件", "widget", "gj", "guajian"],
        value: Constants.ZWSP + 1,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconBoth"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.widget}</span></div>`,
    });
    if (key === "") {
        return allList;
    }
    return allList.filter((item) => {
        if (!item.filter) {
            return false;
        }
        const match = item.filter.find((filter) => {
            if (filter.indexOf(key.toLowerCase()) > -1) {
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
                value: `#${value}#`,
                html: item,
            });
            if (value === response.data.k) {
                hasKey = true;
            }
        });
        if (response.data.k && !hasKey) {
            dataList.splice(0, 0, {
                value: `#${response.data.k}#`,
                html: `<mark>${escapeHtml(response.data.k)}</mark>`,
            });
        }
        protyle.hint.genHTML(dataList, protyle, true);
    });

    return [];
};

export const hintRef = (key: string, protyle: IProtyle, isQuick = false): IHintData[] => {
    const nodeElement = hasClosestBlock(getEditorRange(protyle.wysiwyg.element).startContainer);
    protyle.hint.genLoading(protyle);
    fetchPost("/api/search/searchRefBlock", {
        k: key,
        id: nodeElement ? nodeElement.getAttribute("data-node-id") : protyle.block.parentID,
        beforeLen: Math.floor((Math.max(protyle.element.clientWidth / 2, 320) - 58) / 28.8),
        rootID: protyle.block.rootID,
    }, (response) => {
        const dataList: IHintData[] = [];
        if (response.data.newDoc) {
            const newFileName = Lute.UnEscapeHTMLStr(replaceFileName(response.data.k));
            dataList.push({
                value: `((newFile "${newFileName}${Lute.Caret}"))`,
                html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg>
<span class="b3-list-item__text">${window.siyuan.languages.newFile} <mark>${response.data.k}</mark></span></div>`,
            });
        }
        response.data.blocks.forEach((item: IBlock) => {
            const iconName = getIconByType(item.type);
            let attrHTML = "";
            if (item.name) {
                attrHTML += `<span class="fn__flex"><svg class="fn__flex-center svg--small svg ft__on-background"><use xlink:href="#iconN"></use></svg>&nbsp;${item.name}</span><span class="fn__space"></span>`;
            }
            if (item.alias) {
                attrHTML += `<span class="fn__flex"><svg class="fn__flex-center svg--small svg ft__on-background"><use xlink:href="#iconA"></use></svg>&nbsp;${item.alias}</span><span class="fn__space"></span>`;
            }
            if (item.memo) {
                attrHTML += `<span class="fn__flex"><svg class="fn__flex-center svg--small svg ft__on-background"><use xlink:href="#iconM"></use></svg>&nbsp;${item.memo}</span>`;
            }
            if (attrHTML) {
                attrHTML = `<div class="fn__flex b3-list-item__meta" style="line-height: 1">${attrHTML}</div>`;
            }
            let value = `<span data-type="block-ref" data-id="${item.id}" data-subtype="d">${item.name || item.refText}</span>`;
            if (isQuick) {
                value = `<span data-type="block-ref" data-id="${item.id}" data-subtype="s">${key}</span>`;
            }
            dataList.push({
                value,
                html: `${attrHTML}<div class="b3-list-item__first">
    <svg class="b3-list-item__graphic popover__block" data-id="${item.id}"><use xlink:href="#${iconName}"></use></svg>
    <span class="b3-list-item__text">${item.content}</span>
</div>
<div class="b3-list-item__meta">${item.hPath}</div>`,
            });
        });
        if (isQuick) {
            protyle.hint.splitChar = "((";
            protyle.hint.lastIndex = -1;
        }
        if (dataList.length === 0) {
            dataList.push({
                value: "",
                html: window.siyuan.languages.emptyContent,
            });
        }
        protyle.hint.genHTML(dataList, protyle, true, isQuick);
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
        beforeLen: Math.floor((Math.max(protyle.element.clientWidth / 2, 320) - 58) / 28.8),
        id: nodeElement ? nodeElement.getAttribute("data-node-id") : protyle.block.parentID,
        rootID: protyle.block.rootID,
    }, (response) => {
        const dataList: IHintData[] = [];
        response.data.blocks.forEach((item: IBlock) => {
            const iconName = getIconByType(item.type);
            let attrHTML = "";
            if (item.name) {
                attrHTML += `<span class="fn__flex"><svg class="fn__flex-center svg--small svg ft__on-background"><use xlink:href="#iconN"></use></svg>&nbsp;${item.name}</span><span class="fn__space"></span>`;
            }
            if (item.alias) {
                attrHTML += `<span class="fn__flex"><svg class="fn__flex-center svg--small svg ft__on-background"><use xlink:href="#iconA"></use></svg>&nbsp;${item.alias}</span><span class="fn__space"></span>`;
            }
            if (item.memo) {
                attrHTML += `<span class="fn__flex"><svg class="fn__flex-center svg--small svg ft__on-background"><use xlink:href="#iconM"></use></svg>&nbsp;${item.memo}</span>`;
            }
            if (attrHTML) {
                attrHTML = `<div class="fn__flex b3-list-item__meta" style="line-height: 1">${attrHTML}</div>`;
            }
            dataList.push({
                value: `{{select * from blocks where id='${item.id}'}}`,
                html: `${attrHTML}<div class="b3-list-item__first">
    <svg class="b3-list-item__graphic popover__block" data-id="${item.id}"><use xlink:href="#${iconName}"></use></svg>
    <span class="b3-list-item__text">${item.content}</span>
</div>
<div class="b3-list-item__meta">${item.hPath}</div>`,
            });
        });
        if (dataList.length === 0) {
            dataList.push({
                value: "",
                html: window.siyuan.languages.emptyContent,
            });
        }
        protyle.hint.genHTML(dataList, protyle, true);
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
        protyle.toolbar.subElement.classList.add("fn__none");
    });
};

export const hintRenderWidget = (value: string, protyle: IProtyle) => {
    focusByRange(protyle.toolbar.range);
    insertHTML(protyle.lute.SpinBlockDOM(`<iframe src="/widgets/${value}" data-subtype="widget" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>`), protyle, true);
    protyle.toolbar.subElement.classList.add("fn__none");
};

export const hintRenderAssets = (value: string, protyle: IProtyle) => {
    focusByRange(protyle.toolbar.range);
    const type = value.substring(value.lastIndexOf("."));
    const filename = value.replace("assets/", "");
    let fileMD = "";
    if (Constants.SIYUAN_ASSETS_AUDIO.includes(type)) {
        fileMD += `<audio controls="controls" src="${value}"></audio>`;
    } else if (Constants.SIYUAN_ASSETS_IMAGE.includes(type)) {
        fileMD += `![${filename}](${value})`;
    } else if (Constants.SIYUAN_ASSETS_VIDEO.includes(type)) {
        fileMD += `<video controls="controls" src="${value}"></video>`;
    } else {
        fileMD += `[${filename}](${value})`;
    }
    insertHTML(protyle.lute.SpinBlockDOM(fileMD), protyle);
    protyle.toolbar.subElement.classList.add("fn__none");
};

export const hintMoveBlock = (pathString: string, sourceElements: Element[], protyle: IProtyle) => {
    const doOperations: IOperation[] = [];
    let topSourceElement: Element;
    const parentElement = sourceElements[0].parentElement;
    let sideElement;
    sourceElements.forEach((item, index) => {
        if (index === sourceElements.length - 1) {
            topSourceElement = getTopAloneElement(item);
            sideElement = topSourceElement.nextElementSibling || topSourceElement.previousElementSibling;
            if (topSourceElement.isSameNode(item)) {
                topSourceElement = undefined;
            }
        }
        doOperations.push({
            action: "append",
            id: item.getAttribute("data-node-id"),
            parentID: getDisplayName(pathString, true, true)
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
            zoomOut(protyle, protyle.block.parent2ID, protyle.block.parent2ID);
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
    protyle.toolbar.subElement.classList.add("fn__none");
};
