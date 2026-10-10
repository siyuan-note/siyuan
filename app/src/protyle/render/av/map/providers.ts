import {
    AV_MAP_ATTRIBUTION_LINKS, AVMapAttributionLink, AVMapErrorCode, AVMapPoint, AVMapProvider, AVMapTheme, AVMapViewport,
    sanitizeAVMapPoints,
} from "./protocol";

export const AV_MAP_OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export interface AVMapAdapter {
    setPoints: (points: AVMapPoint[], revision: number) => void;
    fit: () => void;
    resize: () => void;
    setTheme: (theme: AVMapTheme) => void;
    setVisible: (visible: boolean, viewport?: AVMapViewport) => void;
    destroy: () => void;
}

export interface AVMapAdapterCallbacks {
    onMarkerClick: (id: string, revision: number) => void;
    onError: (code: AVMapErrorCode) => void;
    onReady?: () => void;
    onAttributionClick?: (link: AVMapAttributionLink) => void;
}

// The SDK is loaded only in the isolated web entry, never in the main interface.
export const createAVMapAdapter = (provider: AVMapProvider, sdk: any, container: HTMLElement,
                                  callbacks: AVMapAdapterCallbacks): AVMapAdapter => {
    if (provider !== "openfreemap") throw new Error("invalidConfiguration");
    let destroyed = false;
    let revision = -1;
    let points: AVMapPoint[] = [];
    let removeMarkers: Array<() => void> = [];
    const cleanMarkers = () => {
        removeMarkers.forEach(remove => remove());
        removeMarkers = [];
    };
    const error = () => {
        if (!destroyed) callbacks.onError("mapUnavailable");
    };
    const doc = container.ownerDocument;
    const scope = doc.defaultView;
    const map = new sdk.Map({container, style: AV_MAP_OPENFREEMAP_STYLE, center: [0, 0], zoom: 1,
        attributionControl: false, trackResize: false});
    const maplibre = AV_MAP_ATTRIBUTION_LINKS[provider].find(link => link.id === "maplibre");
    map.addControl(new sdk.AttributionControl({compact: true,
        customAttribution: `<a href="${maplibre.href}" target="_blank">${maplibre.label}</a>`}));
    const attribution = container.querySelector<HTMLDetailsElement>(".maplibregl-ctrl-attrib");
    let loaded = false, visible = false, expanded = true, automatic = true;
    let viewport: AVMapViewport;
    let frame = 0, visibleSince: number;
    const syncAttribution = () => {
        // MapLibre 的紧凑控件同时使用 details 状态和此 CSS 类。
        attribution.open = expanded;
        attribution.classList.toggle("maplibregl-compact-show", expanded);
    };
    const stopCollapse = () => {
        scope.cancelAnimationFrame(frame);
        frame = 0;
        visibleSince = undefined;
    };
    const attributionVisible = () => {
        if (!viewport || doc.hidden || !attribution.getClientRects().length || !attribution.textContent?.trim()) return false;
        const rect = attribution.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.top < 0 ||
            rect.right > scope.innerWidth || rect.bottom > scope.innerHeight ||
            rect.left < viewport.x || rect.top < viewport.y || rect.right > viewport.x + viewport.width ||
            rect.bottom > viewport.y + viewport.height) return false;
        return [rect.left + 1, rect.right - 1].every(x => [rect.top + 1, rect.bottom - 1].every(y =>
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
        stopCollapse();
        if (!destroyed && automatic && loaded && visible && !doc.hidden) {
            frame = scope.requestAnimationFrame(tickAttribution);
        }
    };
    const onAttributionInteraction = (event: Event) => {
        if (!event.isTrusted ||
            !(scope.navigator as Navigator & {userActivation?: {isActive: boolean}}).userActivation?.isActive) return;
        automatic = false;
        stopCollapse();
    };
    const onAttributionClick = (event: MouseEvent) => {
        const target = event.target as Element;
        const anchor = target.closest<HTMLAnchorElement>("a");
        const summary = target.closest("summary");
        if (!anchor && !summary) return;
        // 不向供应商文档授予导航或弹窗权限。
        event.preventDefault();
        event.stopImmediatePropagation();
        if (destroyed || !visible || !event.isTrusted || event.button !== 0 ||
            !(scope.navigator as Navigator & {userActivation?: {isActive: boolean}}).userActivation?.isActive) return;
        onAttributionInteraction(event);
        if (summary) {
            expanded = !expanded;
            syncAttribution();
        } else if (attribution.contains(anchor)) {
            const link = AV_MAP_ATTRIBUTION_LINKS[provider].find(item => item.href === anchor.getAttribute("href"));
            if (link) callbacks.onAttributionClick?.(link.id);
        }
    };
    attribution.addEventListener("click", onAttributionClick, true);
    attribution.addEventListener("auxclick", onAttributionClick, true);
    attribution.addEventListener("pointerdown", onAttributionInteraction, true);
    attribution.addEventListener("keydown", onAttributionInteraction, true);
    doc.addEventListener("visibilitychange", updateVisibility);
    // MapLibre 拖动时会收起署名，保留首次展示时间及用户主动选择的展开状态。
    map.on("drag", syncAttribution);
    map.on("resize", syncAttribution);
    syncAttribution();
    const onReady = () => {
        if (!destroyed) {
            loaded = true;
            syncAttribution();
            updateVisibility();
            callbacks.onReady?.();
        }
    };
    map.on("error", error);
    map.on("load", onReady);

    return {
        setPoints: (input, nextRevision) => {
            if (destroyed || nextRevision <= revision) return;
            revision = nextRevision;
            cleanMarkers();
            points = sanitizeAVMapPoints(input);
            points.forEach(point => {
                const onClick = () => {
                    if (!destroyed && nextRevision === revision && points.some(item => item.id === point.id)) {
                        callbacks.onMarkerClick(point.id, nextRevision);
                    }
                };
                const marker = new sdk.Marker().setLngLat([point.longitude, point.latitude]).addTo(map);
                const element = marker.getElement();
                element.addEventListener("click", onClick);
                removeMarkers.push(() => {
                    element.removeEventListener("click", onClick);
                    marker.remove();
                });
            });
        },
        fit: () => {
            if (destroyed || points.length === 0) return;
            const bounds = new sdk.LngLatBounds();
            points.forEach(point => bounds.extend([point.longitude, point.latitude]));
            map.fitBounds(bounds, {padding: 40, maxZoom: 15, duration: 0});
        },
        resize: () => {
            if (!destroyed) map.resize();
        },
        setTheme: theme => {
            if (!destroyed) container.ownerDocument.documentElement.dataset.theme = theme;
        },
        setVisible: (nextVisible, nextViewport) => {
            if (!destroyed && (visible !== nextVisible || JSON.stringify(viewport) !== JSON.stringify(nextViewport))) {
                visible = nextVisible;
                viewport = nextViewport;
                updateVisibility();
            }
        },
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            stopCollapse();
            attribution.removeEventListener("click", onAttributionClick, true);
            attribution.removeEventListener("auxclick", onAttributionClick, true);
            attribution.removeEventListener("pointerdown", onAttributionInteraction, true);
            attribution.removeEventListener("keydown", onAttributionInteraction, true);
            doc.removeEventListener("visibilitychange", updateVisibility);
            map.off("drag", syncAttribution);
            map.off("resize", syncAttribution);
            map.off("load", onReady);
            cleanMarkers();
            points = [];
            map.off("error", error);
            map.remove();
            container.replaceChildren();
        },
    };
};
