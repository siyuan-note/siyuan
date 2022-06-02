import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {hasClosestByClassName} from "../util/hasClosest";

export const chartRender = (element: Element, cdn = Constants.PROTYLE_CDN) => {
    let echartsElements: Element[] = [];
    if (element.getAttribute("data-subtype") === "echarts") {
        // 编辑器内代码块编辑渲染
        echartsElements = [element];
    } else {
        echartsElements = Array.from(element.querySelectorAll('[data-subtype="echarts"]'));
    }
    if (echartsElements.length === 0) {
        return;
    }
    if (echartsElements.length > 0) {
        addScript(`${cdn}/js/echarts/echarts.min.js?v=5.3.2`, "protyleEchartsScript").then(() => {
            addScript(`${cdn}/js/echarts/echarts-gl.min.js?v=2.0.9`, "protyleEchartsGLScript").then(() => {
                let width: number = undefined;
                if (echartsElements[0].firstElementChild.clientWidth === 0) {
                    const tabElement = hasClosestByClassName(echartsElements[0], "layout-tab-container", true);
                    if (tabElement) {
                        Array.from(tabElement.children).find(item => {
                            if (item.classList.contains("protyle") && !item.classList.contains("fn__none")) {
                                width = item.querySelector(".protyle-wysiwyg").firstElementChild.clientWidth;
                                return true;
                            }
                        });
                    }
                }
                echartsElements.forEach((e: HTMLDivElement) => {
                    const text = Lute.UnEscapeHTMLStr(e.getAttribute("data-content"));
                    if (!text || e.getAttribute("data-render") === "true") {
                        return;
                    }
                    if (!e.firstElementChild.classList.contains("protyle-icons")) {
                        e.insertAdjacentHTML("afterbegin", '<div class="protyle-icons"><span class="protyle-icon protyle-icon--first protyle-action__edit"><svg><use xlink:href="#iconEdit"></use></svg></span><span class="protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span></div>');
                    }
                    const renderElement = e.firstElementChild.nextElementSibling as HTMLElement;
                    try {
                        renderElement.style.height = e.style.height;
                        const option = JSON.parse(text);
                        echarts.init(renderElement, window.siyuan.config.appearance.mode === 1 ? "dark" : undefined, {width}).setOption(option);
                        e.setAttribute("data-render", "true");
                        renderElement.classList.remove("ft__error");
                        if (!renderElement.textContent.endsWith(Constants.ZWSP)) {
                            renderElement.firstElementChild.insertAdjacentText("beforeend", Constants.ZWSP);
                        }
                    } catch (error) {
                        echarts.dispose(renderElement);
                        renderElement.classList.add("ft__error");
                        renderElement.innerHTML = `echarts render error: <br>${error}`;
                    }
                });
            });
        });
    }
};
