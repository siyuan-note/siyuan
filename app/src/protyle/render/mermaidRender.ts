import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {hasClosestByAttribute, hasClosestByClassName} from "../util/hasClosest";
import {genIconHTML} from "./util";

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
    addScript(`${cdn}/js/mermaid/mermaid.min.js?v=10.9.1`, "protyleMermaidScript").then(() => {
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
        window.mermaid.initialize(config);
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
    const wysiswgElement = hasClosestByClassName(mermaidElements[0], "protyle-wysiwyg", true);
    mermaidElements.forEach(async (item: HTMLElement) => {
        if (item.getAttribute("data-render") === "true") {
            return;
        }
        if (!item.firstElementChild.classList.contains("protyle-icons")) {
            item.insertAdjacentHTML("afterbegin", genIconHTML(wysiswgElement));
        }
        const renderElement = item.firstElementChild.nextElementSibling as HTMLElement;
        const id = "mermaid" + Lute.NewNodeID();
        renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div contenteditable="false"><span id="${id}"></span></div>`;
        try {
            const mermaidData = await window.mermaid.render(id, Lute.UnEscapeHTMLStr(item.getAttribute("data-content")));
            renderElement.lastElementChild.innerHTML = mermaidData.svg;
        } catch (e) {
            const errorElement = document.querySelector("#" + id);
            renderElement.lastElementChild.innerHTML = `${errorElement.outerHTML}<div class="fn__hr"></div><div class="ft__error">${e.message.replace(/\n/, "<br>")}</div>`;
            errorElement.parentElement.remove();
        }

        item.setAttribute("data-render", "true");
    });
};
