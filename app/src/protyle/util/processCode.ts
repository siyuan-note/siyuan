import {abcRender} from "../render/abcRender";
import {chartRender} from "../render/chartRender";
import {graphvizRender} from "../render/graphvizRender";
import {mathRender} from "../render/mathRender";
import {mermaidRender} from "../render/mermaidRender";
import {mindmapRender} from "../render/mindmapRender";
import {flowchartRender} from "../render/flowchartRender";
import {plantumlRender} from "../render/plantumlRender";
import {Constants} from "../../constants";
import {htmlRender} from "../render/htmlRender";

export const processPasteCode = (html: string, text: string, originalTextHTML: string, protyle: IProtyle) => {
    const tempElement = document.createElement("div");
    tempElement.innerHTML = html;
    let isCode = false;
    if (tempElement.childElementCount === 1 &&
        (tempElement.lastElementChild as HTMLElement).style.fontFamily.indexOf("monospace") > -1) {
        // VS Code
        isCode = true;
    } else if (tempElement.childElementCount === 1 && tempElement.querySelectorAll("pre").length === 1) {
        // IDE
        isCode = true;
    } else if (tempElement.childElementCount === 1 && tempElement.firstElementChild.tagName === "TABLE" &&
        tempElement.querySelector(".line-number") && tempElement.querySelector(".line-content")) {
        // 网页源码
        isCode = true;
    } else if (originalTextHTML.indexOf('<meta name="Generator" content="Cocoa HTML Writer">') > -1 &&
        html.indexOf('\n<p class="p1">') === 0 &&
        //  ChatGPT app 目前没有此标识
        originalTextHTML.indexOf('<style type="text/css">\np.p1') > -1) {
        // Xcode
        isCode = true;
    }

    if (isCode) {
        let code = text || html;
        if (/\n/.test(code)) {
            return protyle.lute.Md2BlockDOM(code);
        } else {
            // Paste code from IDE no longer escape `<` and `>` https://github.com/siyuan-note/siyuan/issues/8340
            code = code.replace("<", "&lt;").replace(">", "&gt;");
            return "`" + code + "`";
        }
    }
    return false;
};

export const processRender = (previewPanel: Element) => {
    const language = previewPanel.getAttribute("data-subtype");
    if (!Constants.SIYUAN_RENDER_CODE_LANGUAGES.includes(language) || previewPanel.getAttribute("data-type") !== "NodeHTMLBlock") {
        abcRender(previewPanel);
        htmlRender(previewPanel);
        plantumlRender(previewPanel);
        mermaidRender(previewPanel);
        flowchartRender(previewPanel);
        chartRender(previewPanel);
        mindmapRender(previewPanel);
        graphvizRender(previewPanel);
        mathRender(previewPanel);
        return;
    }
    if (language === "abc") {
        abcRender(previewPanel);
    } else if (language === "plantuml") {
        plantumlRender(previewPanel);
    } else if (language === "mermaid") {
        mermaidRender(previewPanel);
    } else if (language === "flowchart") {
        flowchartRender(previewPanel);
    } else if (language === "echarts") {
        chartRender(previewPanel);
    } else if (language === "mindmap") {
        mindmapRender(previewPanel);
    } else if (language === "graphviz") {
        graphvizRender(previewPanel);
    } else if (language === "math") {
        mathRender(previewPanel);
    } else if (previewPanel.getAttribute("data-type") === "NodeHTMLBlock") {
        htmlRender(previewPanel);
    }
};
