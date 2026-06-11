import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {genIconHTML} from "./util";
import {hasClosestByClassName} from "../util/hasClosest";

export const graphvizRender = (element: Element, cdn = Constants.PROTYLE_CDN) => {
    let graphvizElements: Element[] | NodeListOf<Element> = [];
    if (element.getAttribute("data-subtype") === "graphviz" && element.getAttribute("data-render") !== "true") {
        graphvizElements = [element];
    } else {
        graphvizElements = element.querySelectorAll('[data-subtype="graphviz"]:not([data-render="true"])');
    }
    if (graphvizElements.length === 0) {
        return;
    }
    addScript(`${cdn}/js/graphviz/viz.js?v=3.11.0`, "protyleGraphVizScript").then(() => {
        const wysiswgElement = hasClosestByClassName(element, "protyle-wysiwyg", true);
        graphvizElements.forEach((e: HTMLDivElement) => {
            e.setAttribute("data-render", "true");
            if (!e.firstElementChild.classList.contains("protyle-icons")) {
                e.insertAdjacentHTML("afterbegin", genIconHTML(wysiswgElement));
            }
            const renderElement = e.firstElementChild.nextElementSibling as HTMLElement;
            if (!e.getAttribute("data-content")) {
                renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span>`;
                return;
            }
            try {
                Viz.instance().then((viz) => {
                    const svgElement = viz.renderSVGElement(Lute.UnEscapeHTMLStr(e.getAttribute("data-content")));
                    renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div contenteditable="false">${svgElement.outerHTML}</div>`;
                }).catch((error) => {
                    renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div class="ft__error" contenteditable="false">graphviz render error: <br>${error}</div>`;
                });
            } catch (e) {
                console.error("Graphviz error", e);
            }
        });
    });
};
