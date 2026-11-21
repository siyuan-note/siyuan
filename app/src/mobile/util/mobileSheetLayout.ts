import {getVisibleViewportBounds} from "./visibleViewport";
import {getMobileSheetHeight} from "./mobileSheetGesture";
import {isMobileLandscape} from "./orientation";

type MobileSheetMode = "standard" | "expanded";

export const bindMobileSheetLayout = (overlay: HTMLElement, sheet: HTMLElement,
                                     options: {onResize?: () => void, onGeometryChange?: () => void, standalone?: boolean} = {}) => {
    let mode: MobileSheetMode = "standard";
    let geometry: string;
    let frozen = false;
    let disposed = false;
    const toolbar = document.getElementById("keyboardToolbar");
    overlay.classList.add("mobile-sheet-layout");
    if (options.standalone) overlay.classList.add("mobile-sheet-layout--standalone");
    sheet.classList.add("mobile-sheet-panel");
    const resize = () => {
        if (disposed || !overlay.isConnected) return;
        const viewport = getVisibleViewportBounds();
        const toolbarRect = toolbar && !toolbar.classList.contains("fn__none") ? toolbar.getBoundingClientRect() : undefined;
        const bottom = toolbarRect && toolbarRect.height !== 0 ? Math.min(viewport.bottom, toolbarRect.top) : viewport.bottom;
        overlay.style.top = `${viewport.top}px`;
        // 整个视口可用时直接贴住布局底边，避免整数高度截断设备像素后露出背景。
        const fullViewport = bottom === window.innerHeight;
        overlay.style.bottom = fullViewport ? "0px" : "auto";
        overlay.style.height = fullViewport ? "auto" : `${Math.max(0, bottom - viewport.top)}px`;
        if (!frozen) {
            const size = window.siyuan.mobile.size;
            const direction = isMobileLandscape() ? size.landscape : size.portrait;
            const fullHeight = Math.max(window.innerHeight, direction?.height1 || 0);
            const style = getComputedStyle(overlay);
            // 安全区只由容器 padding 占位，裁限后的面板高度不再额外扣减。
            const available = Math.max(0, bottom - viewport.top -
                (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0));
            const height = getMobileSheetHeight(fullHeight, available, mode === "expanded");
            sheet.classList.toggle("mobile-sheet-panel--compact", height <= 160);
            const nextGeometry = `${viewport.top}:${bottom}:${available}:${isMobileLandscape()}`;
            if (geometry !== undefined && geometry !== nextGeometry) options.onGeometryChange?.();
            geometry = nextGeometry;
            const maxHeight = `${height}px`;
            sheet.style.maxHeight = maxHeight;
            sheet.style.height = options.standalone && mode === "standard" ? "auto" : maxHeight;
        }
        options.onResize?.();
    };
    const chromeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    const observeChrome = () => sheet.querySelectorAll<HTMLElement>(":scope > .b3-dialog__header, :scope > .b3-menu__title, " +
        ":scope > .b3-dialog__body > .b3-dialog__action")
        .forEach(element => chromeObserver?.observe(element));
    if (chromeObserver) observeChrome();
    const contentObserver = new MutationObserver(() => {
        if (chromeObserver) observeChrome();
        resize();
    });
    contentObserver.observe(sheet, {childList: true, subtree: true, characterData: true});
    const observer = new MutationObserver(resize);
    if (toolbar) observer.observe(toolbar, {attributes: true, attributeFilter: ["class", "style"]});
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    window.screen.orientation?.addEventListener?.("change", resize);
    resize();
    return {
        resize,
        freeze: () => {
            if (frozen || disposed) return;
            const height = `${sheet.getBoundingClientRect().height}px`;
            sheet.style.height = height;
            sheet.style.maxHeight = height;
            frozen = true;
        },
        setMode: (next: MobileSheetMode) => {
            if (mode === next) return;
            mode = next;
            resize();
        },
        dispose: () => {
            if (disposed) return;
            disposed = true;
            observer.disconnect();
            contentObserver.disconnect();
            chromeObserver?.disconnect();
            window.removeEventListener("resize", resize);
            window.removeEventListener("orientationchange", resize);
            window.visualViewport?.removeEventListener("resize", resize);
            window.visualViewport?.removeEventListener("scroll", resize);
            window.screen.orientation?.removeEventListener?.("change", resize);
        },
    };
};
