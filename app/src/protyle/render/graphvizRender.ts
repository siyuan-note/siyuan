import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {genIconHTML} from "./util";

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
        graphvizElements.forEach((e: HTMLDivElement) => {
            if (e.getAttribute("data-render") === "true") {
                return;
            }
            if (!e.firstElementChild.classList.contains("protyle-icons")) {
                e.insertAdjacentHTML("afterbegin", genIconHTML());
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
                    renderElement.innerHTML = result.outerHTML;
                    renderElement.classList.remove("ft__error");
                    renderElement.setAttribute("contenteditable", "false");
                    if (!e.textContent.endsWith(Constants.ZWSP)) {
                        e.insertAdjacentHTML("beforeend", `<span style="position: absolute">${Constants.ZWSP}</span>`);
                    }
                }).catch((error) => {
                    renderElement.innerHTML = `graphviz render error: <br>${error}`;
                    renderElement.classList.add("ft__error");
                });
            } catch (e) {
                console.error("Graphviz error", e);
            }
            e.setAttribute("data-render", "true");
        });
    });
};
