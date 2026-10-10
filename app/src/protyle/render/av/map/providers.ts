import {
    AVMapAttributionLink, AVMapErrorCode, AVMapPoint, AVMapProvider, AVMapTheme, AVMapViewport,
    sanitizeAVMapPoints,
} from "./protocol";
import {AVMapAttributionController, createAVMapAttribution} from "./attribution";

export const AV_MAP_OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

const retryableTileStatuses = new Set([408, 429, 500, 502, 503, 504]);
const isRecoverableTileError = (event: any): boolean => {
    const tile = event?.tile;
    const canonical = tile?.tileID?.canonical;
    // MapLibre 的瓦片错误带有源标识和失败瓦片；其他启动、样式或 worker 错误仍交给宿主处理。
    return event?.type === "error" && typeof event.sourceId === "string" && event.sourceId.trim().length > 0 &&
        tile?.state === "errored" && canonical && typeof canonical === "object" && !Array.isArray(canonical) &&
        Number.isInteger(canonical.z) && canonical.z >= 0 && canonical.z <= 25 &&
        Number.isInteger(canonical.x) && canonical.x >= 0 && canonical.x < 2 ** canonical.z &&
        Number.isInteger(canonical.y) && canonical.y >= 0 && canonical.y < 2 ** canonical.z &&
        retryableTileStatuses.has(event.error?.status);
};

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

// SDK 仅加载于隔离页面，不进入主界面。
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
    const error = (event: unknown) => {
        if (!destroyed && !(loaded && isRecoverableTileError(event))) callbacks.onError("mapUnavailable");
    };
    const map = new sdk.Map({container, style: AV_MAP_OPENFREEMAP_STYLE, center: [0, 0], zoom: 1,
        attributionControl: false, trackResize: false});
    let attribution: AVMapAttributionController;
    let ready = false, loaded = false;
    const onReady = () => {
        if (!destroyed && !ready) {
            ready = true;
            // 样式初始化后即可接收记录并定位，不等待默认世界视图的全部瓦片。
            callbacks.onReady?.();
        }
    };
    const onLoad = () => {
        if (!destroyed && !loaded) {
            loaded = true;
            attribution.onReady();
        }
    };
    const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        try {
            attribution?.destroy();
            map.off("style.load", onReady);
            map.off("load", onLoad);
            map.off("error", error);
            cleanMarkers();
            points = [];
        } finally {
            try {
                map.remove();
            } finally {
                container.replaceChildren();
            }
        }
    };
    try {
        attribution = createAVMapAttribution(provider, sdk, map, container, callbacks.onAttributionClick);
        map.on("error", error);
        map.on("style.load", onReady);
        map.on("load", onLoad);
    } catch (error) {
        destroy();
        throw error;
    }

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
        setVisible: attribution.setVisible,
        destroy,
    };
};
