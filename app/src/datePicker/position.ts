import {getAnchoredMenuPosition} from "../menus/menuPosition";

export const bindDatePickerPosition = (element: HTMLElement, owner: HTMLElement) => {
    const doc = owner.ownerDocument;
    const view = doc.defaultView as Window & typeof globalThis;
    const container = element.querySelector<HTMLElement>(".b3-dialog__container");
    const overlay = element.querySelector<HTMLElement>(".b3-dialog");
    const content = container.querySelector<HTMLElement>(".b3-dialog__content");
    const viewport = view.visualViewport;
    let frame = 0;
    let disposed = false;
    const set = (name: "left" | "top" | "width" | "maxHeight", value: number) => {
        const next = value + "px";
        if (container.style[name] !== next) { container.style[name] = next; }
    };
    const update = () => {
        frame = 0;
        if (disposed || !element.isConnected || !owner.isConnected || owner.ownerDocument !== doc) { return; }
        const leftEdge = (viewport?.offsetLeft || 0) + 8;
        const topEdge = (viewport?.offsetTop || 0) + 8;
        const width = Math.max(1, (viewport?.width ?? view.innerWidth) - 16);
        const height = Math.max(1, (viewport?.height ?? view.innerHeight) - 16);
        set("width", Math.min(300, width));
        const rect = container.getBoundingClientRect();
        const naturalHeight = rect.height + Math.max(0, content.scrollHeight - content.clientHeight);
        const anchor = owner.getBoundingClientRect();
        const anchorBottom = Math.min(topEdge + height, Math.max(topEdge, anchor.bottom + 4));
        const anchorTop = Math.min(topEdge + height, Math.max(topEdge, anchor.top - 4));
        const position = getAnchoredMenuPosition(anchorBottom, anchorBottom - anchorTop, naturalHeight,
            topEdge + height, topEdge);
        // 上下空间都不足时允许覆盖锚点，确保日期输入和操作区仍在可视范围内。
        if (position.height < Math.min(naturalHeight, 160)) {
            position.height = Math.min(naturalHeight, height);
            position.top = Math.max(topEdge, Math.min(anchorBottom, topEdge + height - position.height));
        }
        const origin = overlay.getBoundingClientRect();
        const rtl = view.getComputedStyle(owner).direction === "rtl";
        const left = Math.max(leftEdge, Math.min(rtl ? anchor.right - rect.width : anchor.left, leftEdge + width - rect.width));
        set("maxHeight", position.height);
        set("left", left - origin.left);
        set("top", position.top - origin.top);
    };
    const schedule = () => {
        if (!disposed && !frame) { frame = view.requestAnimationFrame(update); }
    };
    const resize = new view.ResizeObserver(schedule);
    resize.observe(owner);
    resize.observe(container);
    if (content.firstElementChild) { resize.observe(content.firstElementChild); }
    const mutations = new view.MutationObserver(records => {
        if (records.some(record => record.target !== container && record.target !== overlay)) { schedule(); }
    });
    mutations.observe(doc.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"]});
    view.addEventListener("scroll", schedule, {capture: true, passive: true});
    view.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    update();
    schedule();
    return () => {
        disposed = true;
        view.cancelAnimationFrame(frame);
        resize.disconnect();
        mutations.disconnect();
        view.removeEventListener("scroll", schedule, true);
        view.removeEventListener("resize", schedule);
        viewport?.removeEventListener("resize", schedule);
        viewport?.removeEventListener("scroll", schedule);
    };
};
