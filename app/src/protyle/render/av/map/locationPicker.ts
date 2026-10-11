import {fetchSyncPost} from "../../../../util/fetch";
import {createAVMapHost, isAVMapHostEnvironmentSupported} from "./host";
import type {AVMapHost} from "./host";
import {createDesktopAVMapHost, isDesktopAVMapHostSupported} from "./desktopTransport";
import {AV_MAP_ATTRIBUTION_LINKS, sanitizeAVMapPoints} from "./protocol";
import type {AVMapCoordinate} from "./protocol";
import {canLoadMapHost} from "./state";

interface AVLocationPickerOptions {
    canvas: HTMLElement;
    status: HTMLElement;
    point?: AVMapCoordinate;
    isCurrent: () => boolean;
    onPick: (point: AVMapCoordinate) => boolean;
}

// 地图仅接收固定草稿标识和坐标，不传递地点名称、来源或数据库内容。
const getPoints = (point?: AVMapCoordinate) => point ? sanitizeAVMapPoints([
    {id: "location-draft", longitude: point.longitude, latitude: point.latitude},
]) : [];

export const createAVLocationPicker = (options: AVLocationPickerOptions) => {
    const languages = window.siyuan.languages;
    const getTheme = () => document.documentElement.getAttribute("data-theme-mode") === "dark" ? "dark" : "light";
    let host: AVMapHost;
    let themeObserver: MutationObserver;
    let disposed = false;
    let failed = false;
    let revision = 0;
    let points = getPoints(options.point);
    const offline = () => fallback(languages.mapOffline);
    const releaseHost = () => {
        revision++;
        const previous = host;
        host = undefined;
        themeObserver?.disconnect();
        themeObserver = undefined;
        window.removeEventListener("offline", offline);
        previous?.destroy();
    };
    const destroy = () => {
        if (disposed) return;
        disposed = true;
        releaseHost();
    };
    const current = () => {
        if (disposed || failed) return false;
        if (options.isCurrent()) return true;
        destroy();
        return false;
    };
    const fallback = (message: string) => {
        if (!current()) return;
        failed = true;
        releaseHost();
        options.status.textContent = message;
        options.canvas.classList.add("fn__none");
    };
    const setPoint = (point?: AVMapCoordinate) => {
        if (!current()) return;
        points = getPoints(point);
        host?.setPoints(points, ++revision);
    };
    const start = async () => {
        if (!current()) return;
        if (window.siyuan.isPublish) {
            fallback(languages.mapPublicFallback);
            return;
        }
        if (!canLoadMapHost(window.location.protocol)) {
            fallback(languages.mapUnsupportedClient);
            return;
        }
        if (!navigator.onLine) {
            fallback(languages.mapOffline);
            return;
        }
        options.status.textContent = languages.mapLoading;
        window.addEventListener("offline", offline);
        const desktop = await isDesktopAVMapHostSupported();
        if (!current()) return;
        const supported = desktop || await isAVMapHostEnvironmentSupported();
        if (!current()) return;
        if (!supported) {
            fallback(languages.mapUnsupportedClient);
            return;
        }
        if (!navigator.onLine) {
            fallback(languages.mapOffline);
            return;
        }
        const response = await fetchSyncPost("/api/map/getRuntime", {});
        if (!current()) return;
        if (response.code !== 0 || response.data?.provider !== "openfreemap") {
            fallback(response.msg === "mapAuthenticationBypass" ? languages.mapAuthenticationBypass : languages.mapLoadError);
            return;
        }
        options.canvas.classList.remove("fn__none");
        const nextHost = (desktop ? createDesktopAVMapHost : createAVMapHost)(options.canvas, {
            provider: "openfreemap",
            theme: getTheme(),
            title: languages.locationPickOnMap,
            onReady: () => {
                if (current()) options.status.textContent = "";
            },
            onMarkerClick: () => {},
            onPointClick: (point, pointRevision) => {
                if (!current() || pointRevision !== revision) return;
                const selected = getPoints(point)[0];
                if (!selected) return;
                const coordinates = {longitude: selected.longitude, latitude: selected.latitude};
                if (options.onPick(coordinates)) setPoint(coordinates);
            },
            onAttributionClick: id => {
                if (!current()) return;
                const link = AV_MAP_ATTRIBUTION_LINKS.openfreemap.find(item => item.id === id);
                if (link) window.open(link.href, "_blank", "noopener,noreferrer");
            },
            onError: () => fallback(navigator.onLine ? languages.mapLoadError : languages.mapOffline),
        });
        if (!current()) {
            nextHost.destroy();
            return;
        }
        host = nextHost;
        host.setPoints(points, ++revision);
        themeObserver = new MutationObserver(() => {
            if (current()) host?.setTheme(getTheme());
        });
        themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme-mode"]});
    };
    void start().catch(() => fallback(navigator.onLine ? languages.mapLoadError : languages.mapOffline));
    return {setPoint, destroy};
};
