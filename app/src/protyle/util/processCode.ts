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

export const processPasteCode = (html: string, text: string) => {
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
    } else if (html.indexOf('\n<p class="p1">') === 0) {
        // Xcode
        isCode = true;
    } else if (tempElement.childElementCount === 1 && tempElement.firstElementChild.tagName === "TABLE" &&
        tempElement.querySelector(".line-number") && tempElement.querySelector(".line-content")) {
        // 网页源码
        isCode = true;
    }

    if (isCode) {
        let code = text || html;
        if (/\n/.test(code)) {
            // 不要格式化为多行代码块，否则 Lute 解析会出错 https://github.com/siyuan-note/siyuan/issues/8934
            return `<div data-type="NodeCodeBlock" class="code-block" data-node-id="${Lute.NewNodeID()}"><div class="protyle-action"><span class="protyle-action--first protyle-action__language" contenteditable="false">${window.siyuan.storage[Constants.LOCAL_CODELANG]}</span><span class="fn__flex-1"></span><span aria-label="${window.siyuan.languages.copy}" class="b3-tooltips__nw b3-tooltips protyle-icon protyle-icon--first protyle-action__copy"><svg><use xlink:href="#iconCopy"></use></svg></span><span aria-label="${window.siyuan.languages.more}" class="b3-tooltips__nw b3-tooltips protyle-icon protyle-icon--last protyle-action__menu"><svg><use xlink:href="#iconMore"></use></svg></span></div><div contenteditable="true" spellcheck="${window.siyuan.config.editor.spellcheck}">${code.replace(/&/g, "&amp;").replace(/</g, "&lt;")}<wbr></div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
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
    if (!["abc", "plantuml", "mermaid", "flowchart", "echarts", "mindmap", "graphviz", "math"].includes(language) || previewPanel.getAttribute("data-type") !== "NodeHTMLBlock") {
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
