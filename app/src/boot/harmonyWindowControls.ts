interface IHarmonyWindowControlsGeometry {
    windowWidth: number;
    rightInset: number;
    bottom: number;
    movable: boolean;
}

const getGeometry = (value: unknown): IHarmonyWindowControlsGeometry | undefined => {
    if (!value || typeof value !== "object" || !("windowWidth" in value) || !("rightInset" in value) ||
        !("bottom" in value) || !("movable" in value)) {
        return;
    }
    const {windowWidth, rightInset, bottom, movable} = value;
    if (typeof windowWidth === "number" && Number.isFinite(windowWidth) &&
        typeof rightInset === "number" && rightInset > 0 && rightInset < windowWidth &&
        typeof bottom === "number" && Number.isFinite(bottom) && bottom > 0 && typeof movable === "boolean") {
        return {windowWidth, rightInset, bottom, movable};
    }
};

export const initHarmonyWindowControls = () => {
    const bridge = window.SiYuanHarmonyWindowControls;
    const toolbar = document.getElementById("toolbar");
    const gap = toolbar?.querySelector<HTMLElement>(".toolbar__window-gap");
    if (!bridge || window !== window.top || !gap || !document.body.classList.contains("body--harmony")) {
        return;
    }
    const root = document.documentElement;
    let geometry: IHarmonyWindowControlsGeometry | undefined;
    let dragArea = "";
    let frame = 0;

    const updateDragArea = () => {
        frame = 0;
        const rect = gap.getBoundingClientRect();
        const visible = geometry?.movable && window.innerWidth > 0 && rect.width > 0 && rect.height > 0 &&
            document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === gap;
        const scale = visible ? geometry.windowWidth / window.innerWidth : 0;
        const bounds = visible ? [rect.left * scale, rect.top * scale, rect.right * scale, rect.bottom * scale] : [0, 0, 0, 0];
        const next = bounds.join(",");
        if (next !== dragArea) {
            bridge.setDragArea(bounds[0], bounds[1], bounds[2], bounds[3]);
            dragArea = next;
        }
    };
    const scheduleDragArea = () => {
        if (!frame) {
            frame = window.requestAnimationFrame(updateDragArea);
        }
    };
    const applyGeometry = () => {
        if (geometry && window.innerWidth > 0) {
            const scale = window.innerWidth / geometry.windowWidth;
            root.setAttribute("data-harmony-window-controls", geometry.movable ? "movable" : "visible");
            root.style.setProperty("--harmony-window-controls-inset", `${Math.ceil(geometry.rightInset * scale)}px`);
            root.style.setProperty("--harmony-window-controls-bottom", `${Math.ceil(geometry.bottom * scale)}px`);
        } else {
            root.removeAttribute("data-harmony-window-controls");
            root.style.removeProperty("--harmony-window-controls-inset");
            root.style.removeProperty("--harmony-window-controls-bottom");
        }
        scheduleDragArea();
    };

    try {
        geometry = getGeometry(JSON.parse(bridge.connect()));
    } catch (error) {
        console.warn("connect Harmony window controls failed:", error);
        return;
    }
    window.addEventListener("siyuan-harmony-window-controls", (event: CustomEvent<unknown>) => {
        geometry = getGeometry(event.detail);
        dragArea = "";
        window.dispatchEvent(new Event("resize"));
    });
    window.addEventListener("resize", applyGeometry);
    const resizeObserver = new ResizeObserver(scheduleDragArea);
    resizeObserver.observe(toolbar);
    resizeObserver.observe(gap);
    const observer = new MutationObserver(scheduleDragArea);
    observer.observe(toolbar, {attributes: true, attributeFilter: ["class", "data-hide"], childList: true, subtree: true});
    observer.observe(document.body, {attributes: true, attributeFilter: ["class"], childList: true});
    applyGeometry();
    if (geometry) {
        window.dispatchEvent(new Event("resize"));
    }
};
