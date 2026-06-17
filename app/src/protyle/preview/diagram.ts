import {Constants} from "../../constants";
import {addScript} from "../util/addScript";
import {previewImages} from "./image";

const DIAGRAM_SUBTYPES = ["mermaid", "graphviz", "flowchart", "plantuml", "echarts"];

export const getDiagramBlock = (element: HTMLElement) => {
    if (!element) {
        return false;
    }
    if (DIAGRAM_SUBTYPES.includes(element.getAttribute("data-subtype"))) {
        return element;
    }
    return false;
};

/**
 * Open a rendered diagram (mermaid / graphviz / flowchart / plantuml / mindmap) in a
 * full-screen viewer that supports zoom, pan and rotation. The diagram's SVG is rasterized
 * to a PNG via html-to-image (the same library used by the "export as image" action) and
 * handed to the existing image viewer so diagrams get the same controls as image previews.
 *
 * https://github.com/siyuan-note/siyuan/issues/12691
 */
export const previewDiagram = (diagramElement: HTMLElement) => {
    addScript(`${Constants.PROTYLE_CDN}/js/html-to-image.min.js?v=1.11.13`, "protyleHtml2image").then(async () => {
        const renderElement = diagramElement.querySelector('[contenteditable="false"]') || diagramElement;
        let blob: Blob;
        try {
            blob = await window.htmlToImage.toBlob(renderElement);
        } catch (e) {
            return;
        }
        const url = URL.createObjectURL(blob);
        previewImages([url], url, () => URL.revokeObjectURL(url));
    });
};
