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
    addScript(`${cdn}/js/mermaid/mermaid.min.js?v=9.1.1`, "protyleMermaidScript").then(() => {
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
            config.themeVariables = {
                "background": "#333",
                "primaryColor": "#1f2020",
                "secondaryColor": "hsl(180, 1.5873015873%, 28.3529411765%)",
                "tertiaryColor": "hsl(20, 1.5873015873%, 12.3529411765%)",
                "primaryBorderColor": "hsl(180, 0%, 2.3529411765%)",
                "secondaryBorderColor": "hsl(180, 0%, 18.3529411765%)",
                "tertiaryBorderColor": "hsl(20, 0%, 2.3529411765%)",
                "primaryTextColor": "#e0dfdf",
                "secondaryTextColor": "rgb(183.8476190475, 181.5523809523, 181.5523809523)",
                "tertiaryTextColor": "rgb(222.9999999999, 223.6666666666, 223.9999999999)",
                "lineColor": "lightgrey",
                "textColor": "#ccc",
                "mainBkg": "#1f2020",
                "secondBkg": "hsl(180, 1.5873015873%, 28.3529411765%)",
                "mainContrastColor": "lightgrey",
                "darkTextColor": "hsl(28.5714285714, 17.3553719008%, 86.2745098039%)",
                "border1": "#81B1DB",
                "border2": "rgba(255, 255, 255, 0.25)",
                "arrowheadColor": "lightgrey",
                "fontFamily": "\"trebuchet ms\", verdana, arial",
                "fontSize": "16px",
                "labelBackground": "#181818",
                "nodeBkg": "#1f2020",
                "nodeBorder": "#81B1DB",
                "clusterBkg": "hsl(180, 1.5873015873%, 28.3529411765%)",
                "clusterBorder": "rgba(255, 255, 255, 0.25)",
                "defaultLinkColor": "lightgrey",
                "titleColor": "#F9FFFE",
                "edgeLabelBackground": "hsl(0, 0%, 34.4117647059%)",
                "actorBorder": "#81B1DB",
                "actorBkg": "#1f2020",
                "actorTextColor": "lightgrey",
                "actorLineColor": "lightgrey",
                "signalColor": "lightgrey",
                "signalTextColor": "lightgrey",
                "labelBoxBkgColor": "#1f2020",
                "labelBoxBorderColor": "#81B1DB",
                "labelTextColor": "lightgrey",
                "loopTextColor": "lightgrey",
                "noteBorderColor": "rgba(255, 255, 255, 0.25)",
                "noteBkgColor": "#fff5ad",
                "noteTextColor": "#1f2020",
                "activationBorderColor": "#81B1DB",
                "activationBkgColor": "hsl(180, 1.5873015873%, 28.3529411765%)",
                "sequenceNumberColor": "black",
                "sectionBkgColor": "hsl(52.9411764706, 28.813559322%, 58.431372549%)",
                "altSectionBkgColor": "#333",
                "sectionBkgColor2": "#EAE8D9",
                "taskBorderColor": "#ffffff",
                "taskBkgColor": "hsl(180, 1.5873015873%, 35.3529411765%)",
                "taskTextColor": "hsl(28.5714285714, 17.3553719008%, 86.2745098039%)",
                "taskTextLightColor": "lightgrey",
                "taskTextOutsideColor": "lightgrey",
                "taskTextClickableColor": "#003163",
                "activeTaskBorderColor": "#ffffff",
                "activeTaskBkgColor": "#81B1DB",
                "gridColor": "lightgrey",
                "doneTaskBkgColor": "lightgrey",
                "doneTaskBorderColor": "grey",
                "critBorderColor": "#E83737",
                "critBkgColor": "#E83737",
                "taskTextDarkColor": "hsl(28.5714285714, 17.3553719008%, 86.2745098039%)",
                "todayLineColor": "#DB5757",
                "labelColor": "#ccc",
                "errorBkgColor": "#a44141",
                "errorTextColor": "#ddd",
                "altBackground": "hsl(0, 0%, 40%)",
                "fillType0": "#1f2020",
                "fillType1": "hsl(180, 1.5873015873%, 28.3529411765%)",
                "fillType2": "hsl(244, 1.5873015873%, 12.3529411765%)",
                "fillType3": "hsl(244, 1.5873015873%, 28.3529411765%)",
                "fillType4": "hsl(116, 1.5873015873%, 12.3529411765%)",
                "fillType5": "hsl(116, 1.5873015873%, 28.3529411765%)",
                "fillType6": "hsl(308, 1.5873015873%, 12.3529411765%)",
                "fillType7": "hsl(308, 1.5873015873%, 28.3529411765%)",
                "classText": "#e0dfdf"
            };
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
        if (!item.firstElementChild.classList.contains("protyle-icons")) {
            item.insertAdjacentHTML("afterbegin", '<div class="protyle-icons"><span class="protyle-icon protyle-icon--first protyle-action__edit"><svg><use xlink:href="#iconEdit"></use></svg></span><span class="protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span></div>');
        }
        const renderElement = item.firstElementChild.nextElementSibling as HTMLElement;
        const text = Lute.UnEscapeHTMLStr(item.getAttribute("data-content"));
        if (item.getAttribute("data-render") === "true" || text.trim() === "") {
            return;
        }
        renderElement.removeAttribute("data-processed");
        renderElement.textContent = text;
        mermaid.init(undefined, renderElement);
        item.setAttribute("data-render", "true");
        renderElement.setAttribute("contenteditable", "false");
        if (!item.textContent.endsWith(Constants.ZWSP)) {
            item.insertAdjacentHTML("beforeend", `<span style="position: absolute">${Constants.ZWSP}</span>`);
        }
    });
};
