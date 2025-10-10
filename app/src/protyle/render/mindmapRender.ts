import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {hasClosestByClassName} from "../util/hasClosest";
import {genIconHTML} from "./util";

export const mindmapRender = (element: Element, cdn = Constants.PROTYLE_CDN) => {
    let mindmapElements: Element[] = [];
    if (element.getAttribute("data-subtype") === "mindmap") {
        // 编辑器内代码块编辑渲染
        mindmapElements = [element];
    } else {
        mindmapElements = Array.from(element.querySelectorAll('[data-subtype="mindmap"]'));
    }
    if (mindmapElements.length === 0) {
        return;
    }
    addScript(`${cdn}/js/echarts/echarts.min.js?v=0.0.0`, "protyleEchartsScript").then(() => {
        const wysiswgElement = hasClosestByClassName(element, "protyle-wysiwyg", true);
        let width: number = undefined;
        if (wysiswgElement && wysiswgElement.clientWidth > 0 && mindmapElements[0].firstElementChild.clientWidth === 0 && wysiswgElement.firstElementChild) {
            width = wysiswgElement.firstElementChild.clientWidth;
        }
        mindmapElements.forEach((e: HTMLDivElement) => {
            if (e.getAttribute("data-render") === "true") {
                return;
            }
            if (!e.firstElementChild.classList.contains("protyle-icons")) {
                e.insertAdjacentHTML("afterbegin", genIconHTML(wysiswgElement));
            }
            const renderElement = e.firstElementChild.nextElementSibling as HTMLElement;
            if (!e.getAttribute("data-content")) {
                renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span>`;
                return;
            }
            try {
                if (!renderElement.lastElementChild || renderElement.childElementCount === 1) {
                    renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div style="height:${e.style.height || "420px"}" contenteditable="false"></div>`;
                } else {
                    renderElement.lastElementChild.classList.remove("ft__error");
                }
                window.echarts.init(renderElement.lastElementChild, window.siyuan.config.appearance.mode === 1 ? "dark" : undefined, {
                    width,
                }).setOption({
                    series: [
                        {
                            data: [JSON.parse(Lute.EChartsMindmapStr(Lute.UnEscapeHTMLStr(e.getAttribute("data-content"))))],
                            initialTreeDepth: -1,
                            itemStyle: {
                                borderWidth: 0,
                                color: "#4285f4",
                            },
                            label: {
                                backgroundColor: "#f6f8fa",
                                borderColor: "#d1d5da",
                                borderRadius: 6,
                                borderWidth: 0.5,
                                color: "#586069",
                                lineHeight: 20,
                                offset: [-5, 0],
                                padding: [0, 5],
                                position: "insideRight",
                            },
                            lineStyle: {
                                color: "#d1d5da",
                                width: 1,
                            },
                            roam: true,
                            symbol: (value: number, params: { data?: { children?: string } }) => {
                                if (params?.data?.children) {
                                    return "circle";
                                } else {
                                    return "path://";
                                }
                            },
                            type: "tree",
                        },
                    ],
                    tooltip: {
                        trigger: "item",
                        triggerOn: "mousemove",
                    },
                    backgroundColor: "transparent",
                });
            } catch (error) {
                window.echarts.dispose(renderElement.lastElementChild);
                renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div class="ft__error" style="height:${e.style.height || "420px"}" contenteditable="false">Mindmap render error: <br>${error}</div>`;
            }
            e.setAttribute("data-render", "true");
        });
    });
};
