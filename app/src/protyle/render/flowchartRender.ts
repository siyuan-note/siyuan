import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {hasClosestByAttribute, hasClosestByClassName} from "../util/hasClosest";
import {genIconHTML} from "./util";

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
    addScript(`${cdn}/js/flowchart.js/flowchart.min.js?v=1.18.0`, "protyleFlowchartScript").then(() => {
        if (flowchartElements[0].firstElementChild.clientWidth === 0) {
            const observer = new MutationObserver(() => {
                initFlowchart(flowchartElements);
                observer.disconnect();
            });
            const hideElement = hasClosestByAttribute(flowchartElements[0], "fold", "1");
            if (hideElement) {
                observer.observe(hideElement, {attributeFilter: ["fold"]});
            } else {
                const cardElement = hasClosestByClassName(flowchartElements[0], "card__block", true);
                if (cardElement) {
                    observer.observe(cardElement, {attributeFilter: ["class"]});
                }
            }
        } else {
            initFlowchart(flowchartElements);
        }
    });
};

const initFlowchart = (flowchartElements: Element[]) => {
    const wysiswgElement = hasClosestByClassName(flowchartElements[0], "protyle-wysiwyg", true);
    flowchartElements.forEach((item: HTMLElement) => {
        if (item.getAttribute("data-render") === "true") {
            return;
        }
        if (!item.firstElementChild.classList.contains("protyle-icons")) {
            item.insertAdjacentHTML("afterbegin", genIconHTML(wysiswgElement));
        }
        const renderElement = item.firstElementChild.nextElementSibling;
        if (!item.getAttribute("data-content")) {
            renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span>`;
            return;
        }
        try {
            renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div contenteditable="false"></div>`;
            flowchart.parse(Lute.UnEscapeHTMLStr(item.getAttribute("data-content"))).drawSVG(renderElement.lastElementChild);
        } catch (error) {
            renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div class="ft__error" contenteditable="false">Flow Chart render error: <br>${error}</div>`;
        }
        item.setAttribute("data-render", "true");
    });
};
