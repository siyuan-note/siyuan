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

// 将继承的样式写入副本，使 SVG 在独立图片中保留编辑器内的显示效果。
const createDiagramSVG = (element: SVGSVGElement) => {
    const clone = element.cloneNode(true) as SVGSVGElement;
    const elements = [element, ...Array.from(element.querySelectorAll("*"))];
    const clones = [clone, ...Array.from(clone.querySelectorAll("*"))];
    elements.forEach((source, index) => {
        const style = window.getComputedStyle(source);
        const target = clones[index] as SVGElement;
        for (let i = 0; i < style.length; i++) {
            const property = style.item(i);
            target.style.setProperty(property, style.getPropertyValue(property));
        }
    });
    const {width, height} = element.getBoundingClientRect();
    clone.setAttribute("width", `${width}`);
    clone.setAttribute("height", `${height}`);
    clone.style.width = `${width}px`;
    clone.style.height = `${height}px`;
    clone.style.maxWidth = "none";
    clone.style.backgroundColor = "#fff";
    return new Blob([new XMLSerializer().serializeToString(clone)], {type: "image/svg+xml"});
};

// SVG 图表保留矢量内容，画布图表使用 PNG，共用图片预览的缩放和拖动控件。
export const previewDiagram = (diagramElement: HTMLElement) => {
    addScript(`${Constants.PROTYLE_CDN}/js/html-to-image.min.js?v=1.11.13`, "protyleHtml2image").then(async () => {
        const type = diagramElement.getAttribute("data-subtype");
        const renderElement = type === "echarts" ?
            diagramElement.querySelector("canvas") :
            diagramElement.querySelector('[contenteditable="false"] svg');
        if (!renderElement) {
            return;
        }

        let blob: Blob;
        try {
            blob = type === "echarts" ?
                await window.htmlToImage.toBlob(renderElement, {backgroundColor: "#fff"}) :
                createDiagramSVG(renderElement as SVGSVGElement);
        } catch (e) {
            return;
        }
        if (!blob) {
            return;
        }
        const objectURL = URL.createObjectURL(blob);
        previewImages([objectURL], objectURL, () => URL.revokeObjectURL(objectURL));
    });
};
