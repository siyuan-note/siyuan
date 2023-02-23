import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {hasClosestByAttribute} from "../util/hasClosest";

declare const flowchart: {
    parse(text: string): { drawSVG: (type: Element) => void };
};

export const flowchartRender = (element: Element, cdn = Constants.PROTYLE_CDN) => {
    let flowchartElements: Element[] = [];
    if (element.getAttribute("data-subtype") === "flowchart") {
        // 编辑器内代码块编辑渲染
        flowchartElements = [element];
    } else {
        flowchartElements = Array.from(element.querySelectorAll('[data-subtype="flowchart"]'));
    }
    if (flowchartElements.length === 0) {
        return;
    }
    addScript(`${cdn}/js/flowchart.js/flowchart.min.js?v=0.0.0`, "protyleFlowchartScript").then(() => {
        if (flowchartElements[0].firstElementChild.clientWidth === 0) {
            const hideElement = hasClosestByAttribute(flowchartElements[0], "fold", "1");
            if (!hideElement) {
                return;
            }
            const observer = new MutationObserver(() => {
                initFlowchart(flowchartElements);
                observer.disconnect();
            });
            observer.observe(hideElement, {attributeFilter: ["fold"]});
        } else {
            initFlowchart(flowchartElements);
        }
    });
};

const initFlowchart = (flowchartElements: Element[]) => {
    flowchartElements.forEach((item: HTMLElement) => {
        if (item.getAttribute("data-render") === "true") {
            return;
        }
        if (!item.firstElementChild.classList.contains("protyle-icons")) {
            item.insertAdjacentHTML("afterbegin", '<div class="protyle-icons"><span class="protyle-icon protyle-icon--first protyle-action__edit"><svg><use xlink:href="#iconEdit"></use></svg></span><span class="protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span></div>');
        }
        if (item.childElementCount < 4) {
            item.lastElementChild.insertAdjacentHTML("beforebegin", `<span style="position: absolute">${Constants.ZWSP}</span>`);
        }
        const renderElement = item.firstElementChild.nextElementSibling as HTMLElement;
        const flowchartObj = flowchart.parse(Lute.UnEscapeHTMLStr(item.getAttribute("data-content")));
        renderElement.innerHTML = "";
        try {
            flowchartObj.drawSVG(renderElement);
        } catch (error) {
            renderElement.classList.add("ft__error");
            renderElement.innerHTML = `Flow Chart render error: <br>${error}`;
        }
        renderElement.setAttribute("contenteditable", "false");
        item.setAttribute("data-render", "true");
    });
};
