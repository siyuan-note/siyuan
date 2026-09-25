import {Constants} from "../../constants";
import {syncListMindmapHeight} from "../render/listMindmap/height";

export const getBlockHeightTarget = (block: HTMLElement): {element: HTMLElement, property: "height" | "maxHeight"} | undefined => {
    const type = block.dataset.type;
    if (type === "NodeCodeBlock") {
        if (!block.dataset.subtype) {
            return {element: block, property: "maxHeight"};
        }
        return block.dataset.subtype === "echarts" ? {element: block, property: "height"} : undefined;
    }
    if (type === "NodeVideo") {
        const video = block.querySelector("video");
        return video ? {element: video, property: "height"} : undefined;
    }
    if (["NodeMindmap", "NodeIFrame", "NodeWidget"].includes(type) ||
        type === "NodeList" && block.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP) === "1") {
        return {element: block, property: "height"};
    }
};

export const setBlockHeight = (block: HTMLElement, height: string) => {
    const target = getBlockHeightTarget(block);
    if (!target) {
        return;
    }
    target.element.style[target.property] = height;
    const host = block.querySelector<HTMLElement>(":scope > .mindmap-view");
    if (host) {
        syncListMindmapHeight(block, host);
    }
    if (["NodeIFrame", "NodeWidget"].includes(block.dataset.type)) {
        // 高度统一保存在块上，清除历史数据中 iframe 自身的高度。
        const iframe = block.querySelector("iframe");
        if (iframe) {
            iframe.style.height = "";
            iframe.removeAttribute("height");
        }
    }
    if (block.dataset.subtype === "echarts") {
        const chart = block.querySelector<HTMLElement>("[_echarts_instance_]");
        if (chart) {
            chart.style.height = height || "420px";
            window.echarts?.getInstanceById(chart.getAttribute("_echarts_instance_"))?.resize();
        }
    }
};
