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
        const wysiswgElement = hasClosestByClassName(element, "protyle-wysiwyg", true);
        mindmapElements.forEach((e: HTMLDivElement) => {
            if (e.getAttribute("data-render") === "true") {
                return;
            }
            if (!e.firstElementChild.classList.contains("protyle-icons")) {
                e.insertAdjacentHTML("afterbegin", genIconHTML(wysiswgElement));
            }
            const renderElement = e.firstElementChild.nextElementSibling as HTMLElement;
            try {
                let _data=JSON.parse(Lute.EChartsMindmapStr(Lute.UnEscapeHTMLStr(e.getAttribute("data-content"))))
                renderElement.style.height = e.style.height;
                let myChart =window.echarts.init(renderElement, window.siyuan.config.appearance.mode === 1 ? "dark" : undefined, {
                    width,
                });
                myChart.getZr().on('dblclick', function(params:any) {
                    let cur_option=myChart.getOption()
                    let width=cur_option['series'][0]['label']['width']
                    myChart.setOption({
                        series: [
                            {
                                id:"sy",
                                label:{
                                    overflow: (width ? "none" : "truncate"),
                                    width: (width ? undefined : 50)
                                }
                            }
                        ]
                    })
                });
                myChart.setOption({
                    series: [
                        {
                            data: [_data],
                            initialTreeDepth: -1,
                            itemStyle: {
                                borderWidth: 0,
                                color: "#4285f4",
                            },
                            emphasis: {
                                // focus: 'self',
                                itemStyle:{
                                    color:"#f530a0"
                                },
                                label:{
                                    color:"#f530a0",
                                    backgroundColor:"white",
                                    borderColor :"white",
                                    borderWidth:3,
                                    overflow:'break'
                                    // textBorderWidth:1,
                                    // textBorderColor:"green"
                                }
                            },
                            label: {
                                backgroundColor: "#f6f8fa",
                                borderColor: "#d1d5da",
                                borderRadius: 6,
                                borderWidth: 0.5,
                                color: "#586069",
                                lineHeight: 20,
                                // offset: [-5, 0],
                                padding: [0, 5],
                                position: "top",
                                align: 'left',
                                verticalAlign: 'bottom',
                                // overflow:'truncate',
                            },
                            leaves: {
                                itemStyle:{
                                    color:"#33f81b"
                                },
                                label: {
                                    position: 'right',
                                    verticalAlign: 'middle',
                                    align: 'left'
                                }
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
                            id:"sy"
                        },
                    ],
                    tooltip: {
                        trigger: "none",
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
