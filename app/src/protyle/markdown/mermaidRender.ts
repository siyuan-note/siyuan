import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {hasClosestByClassName} from "../util/hasClosest";

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
    addScript(`${cdn}/js/mermaid/mermaid.min.js?v=9.1.7`, "protyleMermaidScript").then(() => {
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
                boxMargin: 8
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
            const tabElement = hasClosestByClassName(mermaidElements[0], "protyle", true);
            if (!tabElement) {
                return;
            }
            const observer = new MutationObserver(() => {
                initMermaid(mermaidElements);
                observer.disconnect();
            });
            observer.observe(tabElement, {attributeFilter: ["class"]});
        } else {
            initMermaid(mermaidElements);
        }
    });
};

const initMermaid = (mermaidElements: Element[]) => {
    mermaidElements.forEach((item) => {
        if (item.getAttribute("data-render") === "true") {
            return;
        }
        if (!item.firstElementChild.classList.contains("protyle-icons")) {
            item.insertAdjacentHTML("afterbegin", '<div class="protyle-icons"><span class="protyle-icon protyle-icon--first protyle-action__edit"><svg><use xlink:href="#iconEdit"></use></svg></span><span class="protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span></div>');
        }
        const renderElement = item.firstElementChild.nextElementSibling as HTMLElement;
        renderElement.removeAttribute("data-processed");
        renderElement.textContent = Lute.UnEscapeHTMLStr(item.getAttribute("data-content"));
        mermaid.init(undefined, renderElement);
        item.setAttribute("data-render", "true");
        renderElement.setAttribute("contenteditable", "false");
        if (!item.textContent.endsWith(Constants.ZWSP)) {
            item.insertAdjacentHTML("beforeend", `<span style="position: absolute">${Constants.ZWSP}</span>`);
        }
    });
};
