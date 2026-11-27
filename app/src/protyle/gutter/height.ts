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

export const createBlockHeightMenu = (height: string, preview: (value: string) => void, commit: (value: string) => void,
                                      bindCommit: (input: HTMLInputElement) => void): IMenu => {
    let rangeElement: HTMLInputElement;
    const languages = window.siyuan.languages;
    const presets = ["25%", "33%", "50%", "67%", "75%", "100%"];
    return {
        id: "height",
        icon: "iconHeight",
        label: languages.height,
        submenu: [{
            id: "heightInput",
            iconHTML: "",
            type: "readonly",
            label: `<div class="fn__flex"><input class="b3-text-field fn__flex-1" value="${height.endsWith("px") ? parseInt(height) : ""}" type="number" min="1" style="margin: 4px 8px 4px 0" placeholder="${languages.height}"><span class="fn__flex-center">px</span></div>`,
            bind: element => {
                const input = element.querySelector("input");
                input.addEventListener("input", () => {
                    const value = input.value ? input.value + "px" : "";
                    preview(value);
                    if (rangeElement) {
                        rangeElement.value = "0";
                        rangeElement.parentElement.setAttribute("aria-label", value || languages.default);
                    }
                });
                bindCommit(input);
            },
        }, ...presets.map(value => ({
            id: "height_" + value,
            iconHTML: "",
            label: value,
            click: () => commit(parseInt(value) + "vh"),
        })), {
            id: "separator_1",
            type: "separator",
        }, {
            id: "heightDrag",
            iconHTML: "",
            type: "readonly",
            label: `<div style="margin: 4px 0;" aria-label="${height ? height.replace("vh", "%") : languages.default}" class="b3-tooltips b3-tooltips__n"><input style="box-sizing: border-box" value="${height.endsWith("vh") ? parseInt(height) : 0}" class="b3-slider fn__block" max="100" min="1" step="1" type="range"></div>`,
            bind: element => {
                rangeElement = element.querySelector("input");
                rangeElement.addEventListener("input", () => {
                    preview(rangeElement.value + "vh");
                    rangeElement.parentElement.setAttribute("aria-label", `${rangeElement.value}%`);
                });
                bindCommit(rangeElement);
            },
        }, {
            id: "separator_2",
            type: "separator",
        }, {
            id: "default",
            iconHTML: "",
            label: languages.default,
            click: () => commit(""),
        }],
    };
};
