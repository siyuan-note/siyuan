import {ipcRenderer, webFrame} from "electron";
import {Constants} from "../constants";
import {resizeTopBar} from "../layout/util";

export interface IWindowControlsOverlay extends EventTarget {
    readonly visible: boolean;
    getTitlebarAreaRect: () => DOMRect;
}

let initialized = false;
let scheduled = false;
let minimumHeight = 31;
let lastLayout = "";
let sizeObserver: ResizeObserver;
let colorContext: CanvasRenderingContext2D | null | undefined;
let lastComputedColor = "";
let lastSymbolColor: string;

const getOverlay = () => (navigator as Navigator & {windowControlsOverlay?: IWindowControlsOverlay}).windowControlsOverlay;

// 用浏览器解析主题颜色并转成 sRGB，避免把原生解析器不支持的颜色格式直接传入 Electron。
const getSymbolColor = (color: string) => {
    if (lastComputedColor === color) return lastSymbolColor;
    try {
        if (!CSS.supports("color", color)) return;
        if (!colorContext) {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            colorContext = canvas.getContext("2d", {willReadFrequently: true});
        }
        if (!colorContext) return;
        colorContext.clearRect(0, 0, 1, 1);
        colorContext.fillStyle = color;
        colorContext.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = colorContext.getImageData(0, 0, 1, 1).data;
        lastComputedColor = color;
        lastSymbolColor = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
        return lastSymbolColor;
    } catch {
        // 无法转换时仅同步高度，保留原有按钮颜色。
        colorContext = undefined;
    }
};

export const updateWindowControlsOverlay = () => {
    scheduled = false;
    const overlay = getOverlay();
    if (!initialized || !overlay) return;
    const visible = overlay.visible && !document.body.classList.contains("body--fullscreen");
    document.documentElement.classList.toggle("window-controls-overlay--hidden", !visible);
    const toolbar = document.querySelector<HTMLElement>("#toolbar, .toolbar__window, .toolbar--settings");
    if (!toolbar) return;
    const standalone = toolbar.classList.contains("toolbar__window");
    const fused = document.body.classList.contains("body--toolbar-hide");
    const rootStyle = getComputedStyle(document.documentElement);
    const height = parseFloat(rootStyle.getPropertyValue(standalone || fused ?
        "--b3-ui-panel-height" : "--b3-ui-toolbar-height")) || (standalone || fused ? 42 : 32);
    const icon = toolbar.querySelector<HTMLElement>(".toolbar__item");
    const symbolColor = getSymbolColor(getComputedStyle(icon || toolbar).color);
    const style = {cmd: "setTitleBarOverlay", symbolColor,
        height: Math.max(minimumHeight, Math.round(height * webFrame.getZoomFactor()))};
    // 主进程按实际应用成功的状态去重，同一请求在失败后仍可重试。
    ipcRenderer.send(Constants.SIYUAN_CMD, style);

    const topRows = new Set<Element>();
    if (standalone || fused) {
        document.querySelectorAll(".layout-tab-bar").forEach(item => {
            const header = item.parentElement;
            const rect = header.getBoundingClientRect();
            if (rect.height > 0 && rect.top <= 1) topRows.add(header);
        });
    }
    document.querySelectorAll(".window-controls-overlay__top-row").forEach(item => {
        if (!topRows.has(item)) item.classList.remove("window-controls-overlay__top-row");
    });
    topRows.forEach(item => item.classList.add("window-controls-overlay__top-row"));

    const safe = overlay.getTitlebarAreaRect();
    const layout = [safe.x, safe.width, safe.height, visible, fused, standalone, innerWidth, webFrame.getZoomFactor()].join(",");
    if (window.siyuan?.isReady) {
        // 外观或可见项刷新后，重新使用工具栏自身的折叠逻辑，避免窄窗口中的按钮溢出。
        if (toolbar.id === "toolbar" && toolbar.scrollWidth > toolbar.clientWidth + 2) resizeTopBar();
        if (lastLayout !== layout) {
            lastLayout = layout;
            window.dispatchEvent(new Event("resize"));
        }
    }
};

const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(updateWindowControlsOverlay, 32);
};

export const initWindowControlsOverlay = (container: HTMLElement) => {
    const overlay = getOverlay();
    if (!document.body.classList.contains("body--windows") || !overlay?.visible) return false;
    if (container.id === "windowControls") {
        container.classList.add("window-controls-overlay__placeholder");
    } else if (!container.querySelector(".window-controls-overlay__placeholder")) {
        const placeholder = document.createElement("div");
        placeholder.className = "window-controls-overlay__placeholder";
        container.append(placeholder);
    }
    if (!initialized) {
        initialized = true;
        minimumHeight = Math.ceil(overlay.getTitlebarAreaRect().height * webFrame.getZoomFactor()) || 31;
        document.documentElement.classList.add("window-controls-overlay");
        new MutationObserver(schedule).observe(document.body, {attributes: true, attributeFilter: ["class"]});
        new MutationObserver(schedule).observe(document.documentElement, {
            attributes: true, attributeFilter: ["data-ui-density", "data-theme-mode"],
        });
        new MutationObserver(schedule).observe(document.head, {childList: true, subtree: true});
        document.head.addEventListener("load", schedule, true);
        const selector = "#toolbar, #windowControls, .toolbar__window, .toolbar--settings, .layout-tab-bar";
        new MutationObserver(records => {
            if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
                node instanceof Element && (node.matches(selector) || node.querySelector(selector))))) schedule();
        }).observe(document.body, {childList: true, subtree: true});
        const toolbar = document.getElementById("toolbar");
        if (toolbar) new MutationObserver(schedule).observe(toolbar, {
            childList: true, subtree: true, attributes: true,
            attributeFilter: ["class", "data-entry-hidden", "data-topbar-empty"],
        });
        sizeObserver = new ResizeObserver(schedule);
        window.addEventListener("resize", schedule);
        overlay.addEventListener("geometrychange", schedule);
    }
    sizeObserver.observe(container);
    updateWindowControlsOverlay();
    return true;
};
