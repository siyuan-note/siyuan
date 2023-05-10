import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {hasClosestByAttribute} from "../util/hasClosest";

declare const mermaid: {
    initialize(options: any): void,
    init(options: any, element: Element): void
};

export const mermaidRender = (element: Element, cdn = Constants.PROTYLE_CDN) => {
    let mermaidElements: Element[] = [];
    if (element.getAttribute("data-subtype") === "mermaid") {
        // 编辑器内代码块编辑渲染
        mermaidElements = [element];
    } else {
        mermaidElements = Array.from(element.querySelectorAll('[data-subtype="mermaid"]'));
    }
    if (mermaidElements.length === 0) {
        return;
    }
    addScript(`${cdn}/js/mermaid/mermaid.min.js?v=9.4.3`, "protyleMermaidScript").then(() => {
        const config: any = {
            securityLevel: "loose", // 升级后无 https://github.com/siyuan-note/siyuan/issues/3587，可使用该选项
            altFontFamily: "sans-serif",
            fontFamily: "sans-serif",
            startOnLoad: false,
            flowchart: {
                htmlLabels: true,
                useMaxWidth: !0
            },
            sequence: {
                useMaxWidth: true,
                diagramMarginX: 8,
                diagramMarginY: 8,
                boxMargin: 8,
                showSequenceNumbers: true // Mermaid 时序图增加序号 https://github.com/siyuan-note/siyuan/pull/6992 https://mermaid.js.org/syntax/sequenceDiagram.html#sequencenumbers
            },
            gantt: {
                leftPadding: 75,
                rightPadding: 20
            }
        };
        if (window.siyuan.config.appearance.mode === 1) {
            config.theme = "dark";
        }
        mermaid.initialize(config);
        if (mermaidElements[0].firstElementChild.clientWidth === 0) {
            const hideElement = hasClosestByAttribute(mermaidElements[0], "fold", "1");
            if (!hideElement) {
                return;
            }
            const observer = new MutationObserver(() => {
                initMermaid(mermaidElements);
                observer.disconnect();
            });
            observer.observe(hideElement, {attributeFilter: ["fold"]});
        } else {
            initMermaid(mermaidElements);
        }
    });
};

const initMermaid = (mermaidElements: Element[]) => {
    mermaidElements.forEach((item, index) => {
        if (item.getAttribute("data-render") === "true") {
            return;
        }
        if (!item.firstElementChild.classList.contains("protyle-icons")) {
            item.insertAdjacentHTML("afterbegin", '<div class="protyle-icons"><span class="protyle-icon protyle-icon--first protyle-action__edit"><svg><use xlink:href="#iconEdit"></use></svg></span><span class="protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span></div>');
        }
        const renderElement = item.firstElementChild.nextElementSibling as HTMLElement;
        renderElement.removeAttribute("data-processed");
        renderElement.textContent = Lute.UnEscapeHTMLStr(item.getAttribute("data-content"));
        setTimeout(() => {
            mermaid.init(undefined, renderElement);
        }, Constants.TIMEOUT_LOAD * index);
        item.setAttribute("data-render", "true");
        renderElement.setAttribute("contenteditable", "false");
        if (!item.textContent.endsWith(Constants.ZWSP)) {
            item.insertAdjacentHTML("beforeend", `<span style="position: absolute">${Constants.ZWSP}</span>`);
        }
    });
};
