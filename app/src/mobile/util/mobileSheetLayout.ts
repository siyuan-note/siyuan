import {getVisibleViewportBounds} from "./visibleViewport";
import {isMobileLandscape} from "./orientation";

export type MobileSheetMode = "standard" | "expanded";

export const getMobileSheetMaxHeight = (fullHeight: number, availableHeight: number, mode: MobileSheetMode) =>
    Math.min(Math.max(0, availableHeight), mode === "expanded" ? Math.max(0, availableHeight) : Math.max(0, fullHeight) * .56);

export const bindMobileSheetLayout = (overlay: HTMLElement, sheet: HTMLElement,
                                     options: {mode?: MobileSheetMode, onResize?: () => void, standalone?: boolean} = {}) => {
    let mode = options.mode || "standard";
    let frozen = false;
    let disposed = false;
    const toolbar = document.getElementById("keyboardToolbar");
    overlay.classList.add("mobile-sheet-layout");
    if (options.standalone) overlay.classList.add("mobile-sheet-layout--standalone");
    sheet.classList.add("mobile-sheet-panel");
    const resize = () => {
        if (disposed || !overlay.isConnected) return;
        const viewport = getVisibleViewportBounds();
        const bottom = toolbar && !toolbar.classList.contains("fn__none") ?
            Math.min(viewport.bottom, toolbar.getBoundingClientRect().top) : viewport.bottom;
        overlay.style.top = `${viewport.top}px`;
        overlay.style.height = `${Math.max(0, bottom - viewport.top)}px`;
        if (!frozen) {
            const size = window.siyuan.mobile.size;
            const direction = isMobileLandscape() ? size.landscape : size.portrait;
            const fullHeight = Math.max(window.innerHeight, direction?.height1 || 0);
            const style = getComputedStyle(overlay);
            // 安全区只由容器 padding 占位，裁限后的面板高度不再额外扣减。
            const available = Math.max(0, bottom - viewport.top -
                (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0));
            const maxHeight = `${getMobileSheetMaxHeight(fullHeight, available, mode)}px`;
            sheet.style.maxHeight = maxHeight;
            sheet.style.height = mode === "expanded" ? maxHeight : "auto";
        }
        options.onResize?.();
    };
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
        setMode: (next: MobileSheetMode) => { mode = next; resize(); },
        dispose: () => {
            if (disposed) return;
            disposed = true;
            observer.disconnect();
            window.removeEventListener("resize", resize);
            window.removeEventListener("orientationchange", resize);
            window.visualViewport?.removeEventListener("resize", resize);
            window.visualViewport?.removeEventListener("scroll", resize);
            window.screen.orientation?.removeEventListener?.("change", resize);
        },
    };
};
