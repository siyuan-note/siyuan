import {abcRender} from "../render/abcRender";
import {chartRender} from "../render/chartRender";
import {graphvizRender} from "../render/graphvizRender";
import {mathRender} from "../render/mathRender";
import {mermaidRender} from "../render/mermaidRender";
import {mindmapRender} from "../render/mindmapRender";
import {flowchartRender} from "../render/flowchartRender";
import {plantumlRender} from "../render/plantumlRender";
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

const RENDER_MAP: Record<string, (previewPanel: Element) => void> = {
    abc: abcRender,
    plantuml: plantumlRender,
    mermaid: mermaidRender,
    flowchart: flowchartRender,
    echarts: chartRender,
    mindmap: mindmapRender,
    graphviz: graphvizRender,
    math: mathRender,
};

export const processRender = (previewPanel: Element) => {
    const language = previewPanel.getAttribute("data-subtype");
    if (RENDER_MAP[language]) {
        RENDER_MAP[language](previewPanel);
        return;
    }
    if (previewPanel.getAttribute("data-type") === "NodeHTMLBlock") {
        htmlRender(previewPanel);
        return;
    }
    for (const render of Object.values(RENDER_MAP)) {
        render(previewPanel);
    }
    htmlRender(previewPanel);
};
