import {AV_MAP_ATTRIBUTION_LINKS, AVMapAttributionLink, AVMapProvider, AVMapViewport} from "./protocol";

export interface AVMapAttributionController {
    onReady: () => void;
    setVisible: (visible: boolean, viewport?: AVMapViewport) => void;
    destroy: () => void;
}

export const createAVMapAttribution = (provider: AVMapProvider, sdk: any, map: any, container: HTMLElement,
                                       onClick?: (link: AVMapAttributionLink) => void): AVMapAttributionController => {
    const doc = container.ownerDocument;
    const scope = doc.defaultView;
    const maplibre = AV_MAP_ATTRIBUTION_LINKS[provider].find(link => link.id === "maplibre");
    const control = new sdk.AttributionControl({compact: true,
        customAttribution: `<a href="${maplibre.href}" target="_blank">${maplibre.label}</a>`});
    let attribution: HTMLDetailsElement;
    let attributionText: HTMLElement;
    let destroyed = false, loaded = false, visible = false, expanded = true, automatic = true;
    let viewport: AVMapViewport;
    let frame = 0, visibleSince: number;
    const syncAttribution = () => {
        if (destroyed) return;
        // MapLibre 的紧凑控件同时使用 details 状态和此 CSS 类。
        attribution.open = expanded;
        attribution.classList.toggle("maplibregl-compact-show", expanded);
    };
    const cancelFrame = () => {
        scope.cancelAnimationFrame(frame);
        frame = 0;
    };
    const attributionVisible = () => {
        if (!viewport || doc.hidden || !attributionText.getClientRects().length || !attributionText.textContent?.trim()) return false;
        const rect = attribution.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.top < 0 ||
            rect.right > scope.innerWidth || rect.bottom > scope.innerHeight ||
            rect.left < viewport.x || rect.top < viewport.y || rect.right > viewport.x + viewport.width ||
            rect.bottom > viewport.y + viewport.height) return false;
        // 紧凑控件的圆角属于透明区域，遮挡检查应命中实际展示的版权文字。
        const textRect = attributionText.getBoundingClientRect();
        if (textRect.width <= 0 || textRect.height <= 0) return false;
        return [textRect.left + 1, textRect.right - 1].every(x => [textRect.top + 1, textRect.bottom - 1].every(y =>
            attribution.contains(doc.elementFromPoint(x, y))));
    };
    const tickAttribution = (now: number) => {
        frame = 0;
        if (destroyed || !automatic || !loaded || !visible || doc.hidden) return;
        if (attributionVisible()) {
            if (visibleSince === undefined) visibleSince = now;
            if (now - visibleSince >= 5000) {
                automatic = false;
                expanded = false;
                syncAttribution();
                return;
            }
        } else {
            visibleSince = undefined;
        }
        frame = scope.requestAnimationFrame(tickAttribution);
    };
    const updateVisibility = () => {
        cancelFrame();
        if (destroyed || !automatic || !loaded || !visible || doc.hidden) {
            visibleSince = undefined;
            return;
        }
        // 尺寸变化后仍完整可见时延续计时；裁剪或遮挡立即中断连续展示。
        if (!attributionVisible()) visibleSince = undefined;
        frame = scope.requestAnimationFrame(tickAttribution);
    };
    const onInteraction = (event: Event) => {
        if (destroyed || !event.isTrusted) return;
        automatic = false;
        cancelFrame();
        visibleSince = undefined;
    };
    const onAttributionClick = (event: MouseEvent) => {
        const target = event.target as Element;
        const anchor = target.closest<HTMLAnchorElement>("a");
        const summary = target.closest("summary");
        if (!anchor && !summary) return;
        // 不向供应商文档授予导航或弹窗权限。
        event.preventDefault();
        event.stopImmediatePropagation();
        if (destroyed || !event.isTrusted || event.button !== 0) return;
        if (summary) {
            // 本地展开不依赖跨宿主可见性消息或外链所需的瞬时激活状态。
            onInteraction(event);
            expanded = !expanded;
            syncAttribution();
        } else if (visible && attribution.contains(anchor) &&
            (scope.navigator as Navigator & {userActivation?: {isActive: boolean}}).userActivation?.isActive) {
            onInteraction(event);
            const link = AV_MAP_ATTRIBUTION_LINKS[provider].find(item => item.href === anchor.getAttribute("href"));
            if (link) onClick?.(link.id);
        }
    };
    const controller: AVMapAttributionController = {
        onReady: () => {
            if (destroyed || loaded) return;
            loaded = true;
            syncAttribution();
            updateVisibility();
        },
        setVisible: (nextVisible, nextViewport) => {
            if (destroyed || visible === nextVisible && viewport?.x === nextViewport?.x && viewport?.y === nextViewport?.y &&
                viewport?.width === nextViewport?.width && viewport?.height === nextViewport?.height) return;
            visible = nextVisible;
            viewport = nextViewport;
            updateVisibility();
        },
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            cancelFrame();
            visibleSince = undefined;
            attribution?.removeEventListener("click", onAttributionClick, true);
            attribution?.removeEventListener("auxclick", onAttributionClick, true);
            attribution?.removeEventListener("pointerdown", onInteraction, true);
            attribution?.removeEventListener("keydown", onInteraction, true);
            doc.removeEventListener("visibilitychange", updateVisibility);
            map.off("drag", syncAttribution);
            map.off("resize", syncAttribution);
        },
    };
    try {
        map.addControl(control);
        attribution = container.querySelector<HTMLDetailsElement>(".maplibregl-ctrl-attrib");
        attributionText = attribution?.querySelector<HTMLElement>(".maplibregl-ctrl-attrib-inner");
        if (!attribution || !attributionText) throw new Error("mapUnavailable");
        attribution.addEventListener("click", onAttributionClick, true);
        attribution.addEventListener("auxclick", onAttributionClick, true);
        attribution.addEventListener("pointerdown", onInteraction, true);
        attribution.addEventListener("keydown", onInteraction, true);
        doc.addEventListener("visibilitychange", updateVisibility);
        // SDK 控件先处理拖动和尺寸事件，再恢复首次展示或用户主动选择的状态。
        map.on("drag", syncAttribution);
        map.on("resize", syncAttribution);
        syncAttribution();
        return controller;
    } catch (error) {
        controller.destroy();
        if (!map.hasControl?.(control)) control.onRemove?.();
        throw error;
    }
};
