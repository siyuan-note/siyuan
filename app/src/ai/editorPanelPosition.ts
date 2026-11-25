export const bindEditorPanelPosition = (host: HTMLElement, scroll: HTMLElement, panel: HTMLElement,
                                        mobile: boolean, anchor: () => HTMLElement | undefined) => {
    const view = host.ownerDocument.defaultView;
    const header = panel.querySelector<HTMLElement>(".ai-editor-panel__header");
    const handle = mobile ? panel.querySelector<HTMLElement>(".ai-editor-panel__grip") : header;
    let manual: {left: number, top: number} | undefined;
    let height: number | undefined;
    let drag: {id: number, x: number, y: number, left: number, top: number, height: number} | undefined;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
    const update = () => {
        if (!panel.isConnected) {
            return;
        }
        const hostRect = host.getBoundingClientRect();
        if (mobile) {
            const viewport = view.visualViewport;
            const bottom = Math.min(hostRect.bottom, viewport ? viewport.offsetTop + viewport.height : view.innerHeight);
            const offset = Math.max(0, hostRect.bottom - bottom);
            panel.style.setProperty("--ai-editor-keyboard-offset", offset + "px");
            const panelBottom = panel.getBoundingClientRect().bottom;
            const maximum = Math.max(1, panelBottom - Math.max(hostRect.top, viewport?.offsetTop || 0) - 8);
            const minimum = Math.min(maximum, header.offsetHeight +
                panel.querySelector<HTMLElement>(".ai-editor-panel__actions").offsetHeight + handle.offsetHeight + 40);
            panel.style.height = height === undefined ? "" : clamp(height, minimum, maximum) + "px";
            panel.style.maxHeight = height === undefined ? `min(55%, ${maximum}px)` : maximum + "px";
            handle.setAttribute("aria-valuemin", String(minimum));
            handle.setAttribute("aria-valuemax", String(maximum));
            handle.setAttribute("aria-valuenow", String(panel.offsetHeight));
            return;
        }
        const maxX = host.clientWidth - panel.offsetWidth - 8;
        const maxY = host.clientHeight - panel.offsetHeight - 8;
        let position = manual;
        if (!position) {
            const rect = anchor()?.getBoundingClientRect();
            let top = rect ? rect.bottom - hostRect.top + 4 : maxY - 8;
            if (rect && top > maxY) {
                top = rect.top - hostRect.top - panel.offsetHeight - 4;
            }
            position = {left: rect ? rect.left - hostRect.left : maxX - 8, top};
        }
        panel.style.left = clamp(position.left, 8, maxX) + "px";
        panel.style.top = clamp(position.top, 8, maxY) + "px";
    };
    const reset = () => {
        manual = undefined;
        height = undefined;
        if (!mobile) {
            panel.style.width = "";
            panel.style.height = "";
            panel.classList.remove("ai-editor-panel--resized");
        }
        update();
    };
    handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || drag || (event.target as HTMLElement).closest("button")) {
            return;
        }
        event.preventDefault();
        drag = {id: event.pointerId, x: event.clientX, y: event.clientY, left: panel.offsetLeft,
            top: panel.offsetTop, height: panel.offsetHeight};
        handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
        if (!drag || drag.id !== event.pointerId) {
            return;
        }
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!dx && !dy && !manual && height === undefined) {
            return;
        }
        if (mobile) {
            height = drag.height - dy;
        } else {
            manual = {left: drag.left + dx, top: drag.top + dy};
        }
        update();
    });
    handle.addEventListener("lostpointercapture", () => drag = undefined);
    handle.addEventListener("dblclick", (event) => {
        if (!(event.target as HTMLElement).closest("button")) {
            reset();
        }
    });
    handle.addEventListener("keydown", (event) => {
        if (event.target !== handle) {
            return;
        }
        const delta = 16;
        if (event.key === "Home") {
            reset();
        } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
            const dx = event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0;
            const dy = event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0;
            if (mobile) {
                height = panel.offsetHeight - dy;
            } else {
                manual = {left: panel.offsetLeft + dx, top: panel.offsetTop + dy};
            }
            update();
        } else {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    });
    const observer = new ResizeObserver(update);
    // 原生缩放先写入行内尺寸。面板达到默认高度上限时，边框尺寸可能暂时没有变化。
    const nativeResize = mobile ? undefined : new MutationObserver(() => {
        if ((panel.style.width || panel.style.height) && !panel.classList.contains("ai-editor-panel--resized")) {
            manual ??= {left: panel.offsetLeft, top: panel.offsetTop};
            panel.classList.add("ai-editor-panel--resized");
            update();
        }
    });
    nativeResize?.observe(panel, {attributes: true, attributeFilter: ["style"]});
    observer.observe(host);
    observer.observe(panel);
    scroll.addEventListener("scroll", update);
    view.addEventListener("resize", update);
    view.visualViewport?.addEventListener("resize", update);
    view.visualViewport?.addEventListener("scroll", update);
    update();
    return {update, destroy: () => {
        observer.disconnect();
        nativeResize?.disconnect();
        view.removeEventListener("resize", update);
        view.visualViewport?.removeEventListener("resize", update);
        view.visualViewport?.removeEventListener("scroll", update);
        scroll.removeEventListener("scroll", update);
    }};
};
