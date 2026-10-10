import {AVMapErrorCode, AVMapPoint, AVMapProvider, AVMapTheme, sanitizeAVMapPoints} from "./protocol";

export const AV_MAP_OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export interface AVMapAdapter {
    setPoints: (points: AVMapPoint[], revision: number) => void;
    fit: () => void;
    resize: () => void;
    setTheme: (theme: AVMapTheme) => void;
    destroy: () => void;
}

export interface AVMapAdapterCallbacks {
    onMarkerClick: (id: string, revision: number) => void;
    onError: (code: AVMapErrorCode) => void;
    onReady?: () => void;
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
    const map = new sdk.Map({container, style: AV_MAP_OPENFREEMAP_STYLE, center: [0, 0], zoom: 1,
        attributionControl: true, trackResize: false});
    const onReady = () => {
        if (!destroyed) callbacks.onReady?.();
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
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            map.off("load", onReady);
            cleanMarkers();
            points = [];
            map.off("error", error);
            map.remove();
            container.replaceChildren();
        },
    };
};
