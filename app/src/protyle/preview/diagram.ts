import {Constants} from "../../constants";
import {addScript} from "../util/addScript";
import {previewImages} from "./image";

const DIAGRAM_SUBTYPES = ["mermaid", "graphviz", "flowchart", "echarts"];

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
 * Open a rendered diagram (mermaid / graphviz / flowchart / echarts) in a
 * full-screen viewer that supports zoom, pan and rotation. The diagram's SVG is rasterized
 * to a PNG via html-to-image (the same library used by the "export as image" action) and
 * handed to the existing image viewer so diagrams get the same controls as image previews.
 */
export const previewDiagram = (diagramElement: HTMLElement) => {
    addScript(`${Constants.PROTYLE_CDN}/js/html-to-image.min.js?v=1.11.13`, "protyleHtml2image").then(async () => {
        const type = diagramElement.getAttribute("data-subtype");
        const renderElement = type === "echarts" ?
            diagramElement.querySelector("canvas") :
            diagramElement.querySelector('[contenteditable="false"] svg');

        let blob: Blob;
        try {
            blob = await window.htmlToImage.toBlob(renderElement, {backgroundColor: "#fff"});
        } catch (e) {
            return;
        }
        const objectURL = URL.createObjectURL(blob);
        previewImages([objectURL], objectURL, () => URL.revokeObjectURL(objectURL));
    });
};
