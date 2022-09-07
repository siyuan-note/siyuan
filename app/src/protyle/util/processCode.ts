import {abcRender} from "../markdown/abcRender";
import {chartRender} from "../markdown/chartRender";
import {graphvizRender} from "../markdown/graphvizRender";
import {mathRender} from "../markdown/mathRender";
import {mermaidRender} from "../markdown/mermaidRender";
import {mindmapRender} from "../markdown/mindmapRender";
import {flowchartRender} from "../markdown/flowchartRender";
import {plantumlRender} from "../markdown/plantumlRender";
import {Constants} from "../../constants";

export const processPasteCode = (html: string, text: string) => {
    const tempElement = document.createElement("div");
    tempElement.innerHTML = html;
    let isCode = false;
    if (tempElement.childElementCount === 1 &&
        (tempElement.lastElementChild as HTMLElement).style.fontFamily.indexOf("monospace") > -1) {
        // VS Code
        isCode = true;
    }
    const pres = tempElement.querySelectorAll("pre");
    if (tempElement.childElementCount === 1 && pres.length === 1
        && pres[0].className !== "protyle-sv") {
        // IDE
        isCode = true;
    }
    if (html.indexOf('\n<p class="p1">') === 0) {
        // Xcode
        isCode = true;
    }
    if (tempElement.childElementCount === 1 && tempElement.firstElementChild.tagName === "TABLE" &&
        tempElement.querySelector(".line-number") && tempElement.querySelector(".line-content")) {
        // 网页源码
        isCode = true;
    }

    if (isCode) {
        const code = text || html;
        if (/\n/.test(code) || pres.length === 1) {
            return `<div data-type="NodeCodeBlock" class="code-block" data-node-id="${Lute.NewNodeID()}"><div class="protyle-action"><span class="protyle-action--first protyle-action__language" contenteditable="false">${localStorage.getItem(Constants.LOCAL_CODELANG) || ""}</span><span class="fn__flex-1"></span><span class="protyle-icon protyle-icon--first protyle-action__copy"><svg><use xlink:href="#iconCopy"></use></svg></span><span class="protyle-icon protyle-icon--last protyle-action__menu"><svg><use xlink:href="#iconMore"></use></svg></span></div><div contenteditable="true" spellcheck="false">${code.replace(/&/g, "&amp;").replace(/</g, "&lt;")}<wbr></div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
        } else {
            return code;
        }
    }
    return false;
};

export const processRender = (previewPanel: Element) => {
    const language = previewPanel.getAttribute("data-subtype");
    if (!language) {
        abcRender(previewPanel);
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
    }
};
