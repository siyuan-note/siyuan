import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {hasClosestByClassName} from "../util/hasClosest";

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
        let width: number = undefined;
        if (mindmapElements[0].firstElementChild.clientWidth === 0) {
            const tabElement = hasClosestByClassName(mindmapElements[0], "layout-tab-container", true);
            if (tabElement) {
                Array.from(tabElement.children).find(item => {
                    if (item.classList.contains("protyle") && !item.classList.contains("fn__none") && item.querySelector(".protyle-wysiwyg").firstElementChild) {
                        width = item.querySelector(".protyle-wysiwyg").firstElementChild.clientWidth;
                        return true;
                    }
                });
            }
        }
        mindmapElements.forEach((e: HTMLDivElement) => {
            if (e.getAttribute("data-render") === "true") {
                return;
            }
            if (!e.firstElementChild.classList.contains("protyle-icons")) {
                e.insertAdjacentHTML("afterbegin", '<div class="protyle-icons"><span class="protyle-icon protyle-icon--first protyle-action__edit"><svg><use xlink:href="#iconEdit"></use></svg></span><span class="protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span></div>');
            }
            const renderElement = e.firstElementChild.nextElementSibling as HTMLElement;
            try {
                renderElement.style.height = e.style.height;
                echarts.init(renderElement, window.siyuan.config.appearance.mode === 1 ? "dark" : undefined, {
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
                                borderRadius: 5,
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
                            // @ts-ignores
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
                e.setAttribute("data-render", "true");
                if (!renderElement.textContent.endsWith(Constants.ZWSP)) {
                    renderElement.firstElementChild.insertAdjacentText("beforeend", Constants.ZWSP);
                }
                renderElement.classList.remove("ft__error");
            } catch (error) {
                renderElement.classList.add("ft__error");
                renderElement.innerHTML = `Mindmap render error: <br>${error}`;
            }
        });
    });
};
