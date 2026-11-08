import {getVisibleViewportBounds} from "./visibleViewport";
import {getMobileSheetBounds} from "./mobileSheetGesture";
import {isMobileLandscape} from "./orientation";

export type MobileSheetMode = "standard" | "expanded";

export const getMobileSheetMaxHeight = (fullHeight: number, availableHeight: number, mode: MobileSheetMode) =>
    Math.min(Math.max(0, availableHeight), mode === "expanded" ? Math.max(0, availableHeight) : Math.max(0, fullHeight) * .56);

export const bindMobileSheetLayout = (overlay: HTMLElement, sheet: HTMLElement,
                                     options: {mode?: MobileSheetMode, onResize?: () => void, onGeometryChange?: () => void, standalone?: boolean} = {}) => {
    let mode = options.mode || "standard";
    let preferred: number;
    let available = 0;
    let standardMax = 0;
    let geometry: string;
    let frozen = false;
    let disposed = false;
    const toolbar = document.getElementById("keyboardToolbar");
    overlay.classList.add("mobile-sheet-layout");
    if (options.standalone) overlay.classList.add("mobile-sheet-layout--standalone");
    sheet.classList.add("mobile-sheet-panel");
    const getBounds = () => {
        // 自然高度测量会展开滚动区域，须在恢复约束后恢复其原有位置。
        const positions = [sheet, ...Array.from(sheet.querySelectorAll<HTMLElement>("*"))]
            .filter(element => element.scrollTop !== 0 || element.scrollLeft !== 0)
            .map(element => ({element, top: element.scrollTop, left: element.scrollLeft}));
        const height = sheet.style.height;
        const maxHeight = sheet.style.maxHeight;
        const body = sheet.querySelector<HTMLElement>(":scope > .b3-dialog__body, :scope > .b3-menu__items");
        const flex = body?.style.flex;
        sheet.style.height = "auto";
        sheet.style.maxHeight = "none";
        if (body) body.style.flex = "none";
        const natural = sheet.getBoundingClientRect().height;
        const footer = body?.querySelector<HTMLElement>(":scope > .b3-dialog__action");
        const chrome = Math.max(0, natural - (body?.getBoundingClientRect().height || 0)) +
            (footer?.getBoundingClientRect().height || 0);
        if (body) body.style.flex = flex;
        sheet.style.height = height;
        sheet.style.maxHeight = maxHeight;
        positions.forEach(({element, top, left}) => {
            element.scrollTop = top;
            element.scrollLeft = left;
        });
        const bounds = getMobileSheetBounds(natural, chrome, available);
        bounds.min = Math.min(bounds.min, Math.max(chrome, standardMax));
        return bounds;
    };
    const resize = () => {
        if (disposed || !overlay.isConnected) return;
        const viewport = getVisibleViewportBounds();
        const bottom = toolbar && !toolbar.classList.contains("fn__none") ?
            Math.min(viewport.bottom, toolbar.getBoundingClientRect().top) : viewport.bottom;
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
            available = Math.max(0, bottom - viewport.top -
                (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0));
            sheet.classList.toggle("mobile-sheet-panel--compact", available <= 160);
            standardMax = getMobileSheetMaxHeight(fullHeight, available, "standard");
            const nextGeometry = `${viewport.top}:${bottom}:${available}:${isMobileLandscape()}`;
            if (geometry !== undefined && geometry !== nextGeometry) options.onGeometryChange?.();
            geometry = nextGeometry;
            const maxHeight = `${preferred === undefined || mode === "expanded" ?
                getMobileSheetMaxHeight(fullHeight, available, mode) : available}px`;
            sheet.style.maxHeight = maxHeight;
            sheet.style.height = mode === "expanded" ? maxHeight : preferred === undefined ? "auto" :
                `${Math.max(getBounds().min, Math.min(preferred, available))}px`;
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
        getBounds,
        setPreferredHeight: (height: number) => {
            preferred = height;
            mode = "standard";
            resize();
        },
        freeze: () => {
            if (frozen || disposed) return;
            const height = `${sheet.getBoundingClientRect().height}px`;
            sheet.style.height = height;
            sheet.style.maxHeight = height;
            frozen = true;
        },
        setMode: (next: MobileSheetMode) => { mode = next; resize(); },
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
