type ResizeAxis = "width" | "height" | "both";

export interface ListMindmapSize {
    width?: number;
    height?: number;
}

interface ResizeOptions {
    block: HTMLElement;
    host: HTMLElement;
    labels: {width: string, height: string};
    canResize: () => boolean;
    prepare: () => Promise<boolean>;
    commit: (size: ListMindmapSize) => Promise<boolean>;
}

interface ResizeGeometry {
    width: number;
    height: number;
    blockWidth: number;
    scaleX: number;
    scaleY: number;
    maxWidth: number;
}

export const getListMindmapResizeSize = (geometry: ResizeGeometry, axis: ResizeAxis, x: number, y: number) => {
    const size: ListMindmapSize = {};
    if (axis !== "height") {
        size.width = x === 0 ? geometry.width : Math.round(Math.min(geometry.maxWidth,
            Math.max(Math.min(120, geometry.width, geometry.maxWidth), geometry.width + x / geometry.scaleX)));
    }
    if (axis !== "width") {
        size.height = Math.round(Math.max(Math.min(80, geometry.height), geometry.height + y / geometry.scaleY));
    }
    return size;
};

// 拖动期间只改变派生视图，松手后一次性更新源块，避免预览尺寸进入其他正文事务。
export const bindListMindmapResize = (options: ResizeOptions) => {
    const {block, host} = options;
    const documentSelf = host.ownerDocument;
    const windowSelf = documentSelf.defaultView;
    const handles = new Map<ResizeAxis, HTMLElement>();
    let disposed = false;
    let saving = false;
    let sequence = 0;
    let active: {
        handle: HTMLElement, axis: ResizeAxis, id: number, x: number, y: number,
        lastX: number, lastY: number, geometry?: ResizeGeometry, size?: ListMindmapSize,
        width: string, height: string, heightPriority: string, sourceStyle: string,
    };
    const horizontal = () => !block.parentElement?.classList.contains("sb");
    const available = () => !disposed && block.isConnected && host.parentElement === block &&
        !host.classList.contains("fullscreen") && options.canResize();
    const allowed = (axis: ResizeAxis) => available() && (axis === "height" || horizontal());
    const describeSize = (handle: HTMLElement, axis: "width" | "height", value: number) => {
        handle.setAttribute("aria-valuemin", "0");
        handle.setAttribute("aria-valuemax", String(Math.max(value,
            axis === "width" ? block.parentElement?.offsetWidth || value : windowSelf.innerHeight || value)));
        handle.setAttribute("aria-valuenow", String(value));
        handle.setAttribute("aria-valuetext", `${value}px`);
    };
    const geometry = (): ResizeGeometry => {
        const rect = host.getBoundingClientRect();
        const parent = block.parentElement;
        const parentRect = parent.getBoundingClientRect();
        const parentStyle = windowSelf.getComputedStyle(parent);
        const scaleX = rect.width / host.offsetWidth || 1;
        const scaleY = rect.height / host.offsetHeight || 1;
        const parentScale = parentRect.width / parent.offsetWidth || scaleX;
        const rightInset = parseFloat(parentStyle.paddingRight) + parseFloat(parentStyle.borderRightWidth);
        return {
            width: host.offsetWidth, height: host.offsetHeight,
            blockWidth: parseFloat(windowSelf.getComputedStyle(block).width) || block.offsetWidth,
            scaleX, scaleY,
            maxWidth: Math.max(1, (parentRect.right - (rightInset || 0) * parentScale - rect.left) / scaleX),
        };
    };
    const restore = () => {
        const previous = active;
        active = undefined;
        if (!previous) {
            return;
        }
        host.style.width = previous.width;
        const changed = (block.getAttribute("style") || "") !== previous.sourceStyle;
        const height = changed ? block.style.height : previous.height;
        if (height) {
            host.style.setProperty("--mindmap-view-height", height, changed ? "" : previous.heightPriority);
        } else {
            host.style.removeProperty("--mindmap-view-height");
        }
        previous.handle.classList.remove("touch-resize-active");
        if (previous.handle.hasPointerCapture(previous.id)) {
            previous.handle.releasePointerCapture(previous.id);
        }
        return previous;
    };
    const cancel = () => {
        sequence++;
        restore();
    };
    const save = async (size: ListMindmapSize, initial: ResizeGeometry) => {
        const next: ListMindmapSize = {};
        if (size.width !== undefined && size.width !== initial.width) {
            next.width = Math.max(1, initial.blockWidth + size.width - initial.width);
        }
        if (size.height !== undefined && size.height !== initial.height) {
            next.height = size.height;
        }
        if (next.width === undefined && next.height === undefined) {
            return;
        }
        saving = true;
        try {
            await options.commit(next);
        } catch (error) {
            console.error(error);
        } finally {
            saving = false;
        }
    };
    const preview = () => {
        if (!active?.geometry) {
            return;
        }
        if (!allowed(active.axis) || (block.getAttribute("style") || "") !== active.sourceStyle) {
            cancel();
            return;
        }
        active.size = getListMindmapResizeSize(active.geometry, active.axis,
            active.lastX - active.x, active.lastY - active.y);
        if (active.axis !== "both") {
            describeSize(active.handle, active.axis, active.size[active.axis]);
        }
        if (active.size.width !== undefined) {
            host.style.width = `${active.size.width}px`;
        }
        if (active.size.height !== undefined) {
            host.style.setProperty("--mindmap-view-height", `${active.size.height}px`);
        }
    };
    const move = (event: PointerEvent) => {
        if (!active || event.pointerId !== active.id) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        active.lastX = event.clientX;
        active.lastY = event.clientY;
        preview();
    };
    const end = (event: PointerEvent) => {
        if (!active || event.pointerId !== active.id) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        move(event);
        const previous = restore();
        sequence++;
        if (previous?.geometry && previous.size && allowed(previous.axis)) {
            void save(previous.size, previous.geometry);
        }
    };
    const interrupted = (event: PointerEvent) => {
        if (active?.id === event.pointerId) {
            cancel();
        }
    };
    const keyDown = (event: KeyboardEvent) => {
        if (active && event.key === "Escape") {
            event.preventDefault();
            event.stopImmediatePropagation();
            cancel();
        }
    };
    const stopTouch = (event: Event) => event.stopPropagation();
    for (const axis of ["width", "height", "both"] as const) {
        const handle = documentSelf.createElement("div");
        handle.className = "protyle-block-resize mindmap-view__resize";
        handle.dataset.resizeAxis = axis;
        handle.setAttribute("data-prevent-swipe", "true");
        if (axis !== "both") {
            handle.setAttribute("role", "separator");
            handle.setAttribute("aria-label", options.labels[axis]);
            handle.setAttribute("aria-orientation", axis === "width" ? "vertical" : "horizontal");
            handle.tabIndex = 0;
        } else {
            // 键盘通过两个单轴把手操作，双轴角落仅作为指针命中区域。
            handle.setAttribute("aria-hidden", "true");
        }
        handle.addEventListener("pointerdown", event => {
            if (active || saving || event.button !== 0 || !event.isPrimary || !allowed(axis)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const current = ++sequence;
            active = {handle, axis, id: event.pointerId, x: event.clientX, y: event.clientY,
                lastX: event.clientX, lastY: event.clientY, width: host.style.width,
                height: host.style.getPropertyValue("--mindmap-view-height"),
                heightPriority: host.style.getPropertyPriority("--mindmap-view-height"),
                sourceStyle: block.getAttribute("style") || ""};
            handle.setPointerCapture(event.pointerId);
            handle.classList.add("touch-resize-active");
            void options.prepare().then(ready => {
                if (current !== sequence || !active) {
                    return;
                }
                if (!ready || !allowed(axis)) {
                    cancel();
                    return;
                }
                active.geometry = geometry();
                active.width = host.style.width;
                active.height = host.style.getPropertyValue("--mindmap-view-height");
                active.heightPriority = host.style.getPropertyPriority("--mindmap-view-height");
                active.sourceStyle = block.getAttribute("style") || "";
                preview();
            }).catch(error => {
                if (current === sequence) {
                    cancel();
                }
                console.error(error);
            });
        });
        handle.addEventListener("lostpointercapture", interrupted);
        handle.addEventListener("keydown", event => {
            // 把手保留 Tab 的默认焦点导航，不把按键交给画布新增或删除节点。
            event.stopPropagation();
            const key = event.key;
            if (active || saving || event.altKey || event.ctrlKey || event.metaKey || !allowed(axis) ||
                !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key) ||
                axis === "width" && ["ArrowUp", "ArrowDown"].includes(key) ||
                axis === "height" && ["ArrowLeft", "ArrowRight"].includes(key)) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            const current = ++sequence;
            saving = true;
            void options.prepare().then(async ready => {
                if (!ready || current !== sequence || !allowed(axis)) {
                    return;
                }
                const initial = geometry();
                const step = event.shiftKey ? 1 : 10;
                const x = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
                const y = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
                await save(getListMindmapResizeSize(initial,
                    x ? "width" : "height", x * initial.scaleX, y * initial.scaleY), initial);
            }).catch(error => console.error(error)).finally(() => saving = false);
        });
        ["touchstart", "touchmove", "touchend", "touchcancel"].forEach(type => handle.addEventListener(type, stopTouch));
        handles.set(axis, handle);
        host.appendChild(handle);
    }
    const refresh = () => {
        handles.forEach((handle, axis) => {
            handle.hidden = !allowed(axis);
            if (axis !== "both") {
                describeSize(handle, axis, axis === "width" ? host.offsetWidth : host.offsetHeight);
            }
        });
        if (active && !allowed(active.axis)) {
            cancel();
        } else {
            preview();
        }
    };
    const observer = new MutationObserver(refresh);
    observer.observe(host, {attributes: true, attributeFilter: ["class"]});
    windowSelf.addEventListener("pointermove", move, {capture: true, passive: false});
    windowSelf.addEventListener("pointerup", end, {capture: true, passive: false});
    windowSelf.addEventListener("pointercancel", interrupted, true);
    windowSelf.addEventListener("blur", cancel);
    windowSelf.addEventListener("keydown", keyDown, true);
    refresh();
    return {refresh, destroy: () => {
        disposed = true;
        cancel();
        observer.disconnect();
        windowSelf.removeEventListener("pointermove", move, true);
        windowSelf.removeEventListener("pointerup", end, true);
        windowSelf.removeEventListener("pointercancel", interrupted, true);
        windowSelf.removeEventListener("blur", cancel);
        windowSelf.removeEventListener("keydown", keyDown, true);
        handles.forEach(handle => handle.remove());
    }};
};
