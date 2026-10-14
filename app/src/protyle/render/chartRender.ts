import {addScript} from "../util/addScript";
import {isFoldedRenderContent} from "./foldedContent";
import {loadECharts} from "../util/echarts";
import {Constants} from "../../constants";
import {hasClosestByClassName} from "../util/hasClosest";
import {looseJsonParse} from "../../util/functions";
import {genIconHTML} from "./util";
import {getHostCapabilities, isExternalURLAllowed} from "../../util/hostCapabilities";
import {escapeHtml} from "../../util/escape";

const secureEChartsOption = (option: any) => {
    if (!getHostCapabilities().remoteKernel || !option || typeof option !== "object") {
        return option;
    }
    const pending = [option];
    while (pending.length > 0) {
        const current = pending.pop();
        Object.entries(current).forEach(([key, value]) => {
            if (typeof value === "string" && ["href", "link", "src", "url"].includes(key) &&
                !isExternalURLAllowed(value, true)) {
                current[key] = "about:blank";
                return;
            }
            if (key === "tooltip" && value !== false) {
                if (Array.isArray(value)) {
                    value.forEach((tooltip) => {
                        if (tooltip && typeof tooltip === "object") {
                            tooltip.renderMode = "richText";
                        }
                    });
                } else {
                    current[key] = {
                        ...(value && typeof value === "object" ? value : {}),
                        renderMode: "richText",
                    };
                }
            }
            if (value && typeof value === "object") {
                pending.push(value);
            }
        });
    }
    if (option.tooltip !== false && !Array.isArray(option.tooltip)) {
        option.tooltip = {
            ...(option.tooltip && !Array.isArray(option.tooltip) ? option.tooltip : {}),
            renderMode: "richText",
        };
    }
    return option;
};

// 导出副本直接绘制最终状态，覆盖系列和多组配置中单独启用的动画与渐进绘制。
const prepareChartImageOption = (option: any) => {
    option.animation = false;
    const pending = [option];
    while (pending.length > 0) {
        const current = pending.pop();
        Object.entries(current).forEach(([key, value]) => {
            if (key === "animation") {
                current[key] = false;
            }
            if (key === "series") {
                (Array.isArray(value) ? value : [value]).forEach(series => {
                    if (series && typeof series === "object") {
                        series.animation = false;
                        series.progressive = 0;
                    }
                });
            }
            if (value && typeof value === "object") {
                pending.push(value);
            }
        });
    }
    return option;
};

const renderCharts = async (element: Element, cdn: string, image = false) => {
    if (element.closest('[data-protyle-lite-render="safe"]')) {
        return;
    }
    let echartsElements: Element[] | NodeListOf<Element> = [];
    if (element.getAttribute("data-subtype") === "echarts" && element.getAttribute("data-render") !== "true") {
        echartsElements = [element];
    } else {
        echartsElements = element.querySelectorAll('[data-subtype="echarts"]:not([data-render="true"])');
    }
    echartsElements = Array.from(echartsElements).filter(item => !isFoldedRenderContent(item));
    if (echartsElements.length === 0) {
        return;
    }
    await loadECharts(cdn);
    await addScript(`${cdn}/js/echarts/echarts-gl.min.js?v=2.1.0`, "protyleEchartsGLScript");
    const wysiswgElement = hasClosestByClassName(element, "protyle-wysiwyg", true);
    let width: number = undefined;
    if (wysiswgElement && wysiswgElement.clientWidth > 0 && echartsElements[0].firstElementChild.clientWidth === 0 && wysiswgElement.firstElementChild) {
        width = wysiswgElement.firstElementChild.clientWidth;
    }
    await Promise.all(echartsElements.map(async (e: HTMLDivElement) => {
        if (e.closest('[data-protyle-lite-render="safe"], .mindmap-view__preview-block')) {
            return;
        }
        e.setAttribute("data-render", "true");
        if (!e.firstElementChild.classList.contains("protyle-icons")) {
            e.insertAdjacentHTML("afterbegin", genIconHTML(wysiswgElement, ["refresh", "edit", "more"]));
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
            const chartInstance = window.echarts.getInstanceById(renderElement.lastElementChild?.getAttribute("_echarts_instance_"));
            let option = secureEChartsOption(await looseJsonParse(
                Lute.UnEscapeHTMLStr(e.getAttribute("data-content"))));
            if (image) {
                option = prepareChartImageOption(option);
            }
            if (chartInstance) {
                if (chartInstance.getOption().series[0]?.type !== option.series[0]?.type) {
                    chartInstance.clear();
                }
                chartInstance?.resize();
            }
            window.echarts.init(renderElement.lastElementChild, window.siyuan.config.appearance.mode === 1 ? "dark" : undefined, {width}).setOption(option);
        } catch (error) {
            window.echarts.dispose(renderElement.lastElementChild);
            renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div class="ft__error" style="height:${e.style.height || "420px"}" contenteditable="false">echarts render error: <br>${escapeHtml(String(error))}</div>`;
        }
    }));
};

export const chartRender = (element: Element, cdn = Constants.PROTYLE_CDN) => {
    void renderCharts(element, cdn);
};

// 图片预览在开放复制和导出操作前等待图表脚本加载、配置解析与静态绘制完成。
export const renderChartsForImage = (element: Element) => {
    return renderCharts(element, Constants.PROTYLE_CDN, true);
};

export const refreshChartTheme = (element: Element) => {
    if (element.closest('[data-protyle-lite-render="safe"]') || typeof window.echarts === "undefined") {
        return;
    }
    let echartsElements: HTMLElement[] | NodeListOf<HTMLElement> = [];
    if (element.matches('[data-subtype="echarts"]')) {
        echartsElements = [element as HTMLElement];
    } else {
        echartsElements = element.querySelectorAll<HTMLElement>('[data-subtype="echarts"]');
    }
    echartsElements.forEach((item) => {
        if (item.closest('[data-protyle-lite-render="safe"], .mindmap-view__preview-block')) {
            return;
        }
        const chartElement = item.querySelector<HTMLElement>("[_echarts_instance_]");
        if (!chartElement) {
            return;
        }
        const chartInstance = window.echarts.getInstanceById(chartElement.getAttribute("_echarts_instance_"));
        // 原地切换主题保留画布尺寸，后台页签无需测量隐藏容器。
        chartInstance?.setTheme(window.siyuan.config.appearance.mode === 1 ? "dark" : "default");
    });
};
