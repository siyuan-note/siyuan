import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {genIconHTML} from "./util";
import {hasClosestByClassName} from "../util/hasClosest";

export const graphvizRender = (element: Element, cdn = Constants.PROTYLE_CDN) => {
    let graphvizElements: Element[] = [];
    if (element.getAttribute("data-subtype") === "graphviz") {
        // 编辑器内代码块编辑渲染
        graphvizElements = [element];
    } else {
        graphvizElements = Array.from(element.querySelectorAll('[data-subtype="graphviz"]'));
    }
    if (graphvizElements.length === 0) {
        return;
    }
    addScript(`${cdn}/js/graphviz/viz.js?v=0.0.0`, "protyleGraphVizScript").then(() => {
        const wysiswgElement = hasClosestByClassName(element, "protyle-wysiwyg", true);
        graphvizElements.forEach((e: HTMLDivElement) => {
            if (e.getAttribute("data-render") === "true") {
                return;
            }
            if (!e.firstElementChild.classList.contains("protyle-icons")) {
                e.insertAdjacentHTML("afterbegin", genIconHTML(wysiswgElement));
            }
            const renderElement = e.firstElementChild.nextElementSibling as HTMLElement;
            try {
                const blob = new Blob([`importScripts('${(document.getElementById("protyleGraphVizScript") as HTMLScriptElement).src.replace("viz.js", "full.render.js")}');`],
                    {type: "application/javascript"});
                const url = window.URL || window.webkitURL;
                const blobUrl = url.createObjectURL(blob);
                const worker = new Worker(blobUrl);
                new Viz({worker})
                    .renderSVGElement(Lute.UnEscapeHTMLStr(e.getAttribute("data-content"))).then((result: HTMLElement) => {
                    renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div contenteditable="false">${result.outerHTML}</div>`;
                }).catch((error) => {
                    renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div class="ft__error" contenteditable="false">graphviz render error: <br>${error}</div>`;
                });
            } catch (e) {
                console.error("Graphviz error", e);
            }
            e.setAttribute("data-render", "true");
        });
    });
};
