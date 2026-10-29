import {getTopBarHeight} from "../layout/getTopBarHeight";

interface PDFReadingPosition {
    pageNumber: number;
    left: number;
    top: number;
}

interface PDFPaneApplication {
    pdfViewer?: {
        _location?: PDFReadingPosition;
        scrollPageIntoView: (options: {
            pageNumber: number;
            destArray: unknown[];
            allowNegativeOffset: boolean;
            ignoreDestinationZoom: boolean;
        }) => void;
    };
    eventBus?: {dispatch: (name: string, data: {source: HTMLElement}) => void};
}

let activePane: {restore: () => void} | undefined;

export const bindPdfMaximize = (element: HTMLElement, pdf: PDFPaneApplication, previewOnly = false) => {
    const outer = element.querySelector<HTMLElement>(".pdf__outer");
    const button = element.querySelector<HTMLButtonElement>("#pdfMaximize");
    if (!outer || !button || previewOnly || element.classList.contains("pdf-viewer--mobile")) {
        return () => {};
    }
    button.disabled = false;
    const controller = new AbortController();
    let maximized = false;
    let frame = 0;
    let pendingPosition: PDFReadingPosition | undefined;
    const resize = (position = pdf.pdfViewer?._location) => {
        if (!pendingPosition && position) {
            pendingPosition = {...position};
        }
        if (frame) {
            return;
        }
        frame = requestAnimationFrame(() => {
            frame = 0;
            const position = pendingPosition;
            pendingPosition = undefined;
            if (!element.isConnected || element.closest(".fn__none")) {
                return;
            }
            pdf.eventBus?.dispatch("resize", {source: outer});
            if (position) {
                pdf.pdfViewer?.scrollPageIntoView({
                    pageNumber: position.pageNumber,
                    destArray: [null, {name: "XYZ"}, position.left, position.top, null],
                    allowNegativeOffset: true,
                    ignoreDestinationZoom: true,
                });
            }
        });
    };
    const updateTop = () => {
        if (maximized) {
            outer.style.setProperty("--pdf-maximized-top", `${getTopBarHeight()}px`);
        }
    };
    const setMaximized = (enter: boolean) => {
        if (maximized === enter) {
            return;
        }
        if (enter) {
            activePane?.restore();
        }
        const position = pdf.pdfViewer?._location;
        maximized = enter;
        if (enter) {
            activePane = pane;
            updateTop();
        } else {
            outer.style.removeProperty("--pdf-maximized-top");
            if (activePane === pane) {
                activePane = undefined;
            }
        }
        outer.classList.toggle("pdf__outer--maximized", enter);
        button.setAttribute("aria-pressed", String(enter));
        button.setAttribute("aria-label", enter ? window.siyuan.languages.restore : window.siyuan.languages.max);
        button.querySelector("use").setAttribute("xlink:href", enter ? "#iconFullscreenExit" : "#iconFullscreen");
        resize(position);
    };
    const pane = {restore: () => setMaximized(false)};
    button.addEventListener("click", () => setMaximized(!maximized), {signal: controller.signal});
    window.addEventListener("resize", updateTop, {signal: controller.signal});
    // 也覆盖分屏拖动和横竖屏切换，且不触发其他 PDF 实例的重排。
    const observer = new ResizeObserver(() => resize());
    observer.observe(outer);
    const visibility = new MutationObserver(() => {
        if (maximized && element.closest(".fn__none")) {
            setMaximized(false);
        }
    });
    visibility.observe(element, {attributes: true, attributeFilter: ["class"]});
    return () => {
        setMaximized(false);
        controller.abort();
        observer.disconnect();
        visibility.disconnect();
        cancelAnimationFrame(frame);
        frame = 0;
        pendingPosition = undefined;
    };
};
