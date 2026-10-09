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

// SDK 仅由独立 web 入口加载，主界面不得导入此模块或任何外部 SDK。
export const createAVMapAdapter = (provider: AVMapProvider, sdk: any, container: HTMLElement,
                                  callbacks: AVMapAdapterCallbacks,
                                  baiduCoordinateTypes?: {bd09?: unknown; gcj02?: unknown}): AVMapAdapter => {
    let destroyed = false;
    let revision = -1;
    let points: AVMapPoint[] = [];
    let removeMarkers: Array<() => void> = [];
    let map: any;
    let tencentLayer: any;
    let markers: any[] = [];
    let removeReadyListener = () => {};
    const cleanMarkers = () => {
        removeMarkers.forEach((remove) => remove());
        removeMarkers = [];
        markers = [];
        tencentLayer?.setGeometries([]);
    };
    const error = () => {
        if (!destroyed) {
            callbacks.onError("mapUnavailable");
        }
    };
    const click = (id: string, renderedRevision: number) => {
        if (!destroyed && renderedRevision === revision && points.some((point) => point.id === id)) {
            callbacks.onMarkerClick(id, renderedRevision);
        }
    };
    if (provider === "openfreemap") {
        map = new sdk.Map({container, style: AV_MAP_OPENFREEMAP_STYLE, center: [0, 0], zoom: 1,
            attributionControl: true, trackResize: false});
        map.on("error", error);
    } else if (provider === "amap") {
        map = new sdk.Map(container, {zoom: 3, center: [105, 35], resizeEnable: false,
            viewMode: "2D", showIndoorMap: false});
        map.on("error", error);
    } else if (provider === "tencent") {
        map = new sdk.Map(container, {center: new sdk.LatLng(35, 105), zoom: 3, pitch: 0, rotation: 0});
        tencentLayer = new sdk.MultiMarker({map, geometries: [],
            styles: {marker: new sdk.MarkerStyle({width: 20, height: 30, anchor: {x: 10, y: 30}})}});
    } else if (provider === "baidu") {
        map = new sdk.Map(container);
        map.centerAndZoom(new sdk.Point(105, 35), 3);
        map.enableScrollWheelZoom();
        map.disableMapClick();
        map.disableIconInfoWindow();
    } else {
        throw new Error("invalidConfiguration");
    }
    const onReady = () => {
        if (!destroyed) {
            callbacks.onReady?.();
        }
    };
    const readyEvent = provider === "openfreemap" ? "load" : provider === "amap" ? "complete" : "tilesloaded";
    if (provider === "baidu") {
        map.addEventListener(readyEvent, onReady);
        removeReadyListener = () => map.removeEventListener(readyEvent, onReady);
    } else {
        map.on(readyEvent, onReady);
        removeReadyListener = () => map.off(readyEvent, onReady);
    }

    const adapter: AVMapAdapter = {
        setPoints: (input, nextRevision) => {
            if (destroyed || nextRevision <= revision) {
                return;
            }
            revision = nextRevision;
            cleanMarkers();
            points = sanitizeAVMapPoints(input, provider);
            if (provider === "tencent") {
                // 经纬度顺序由腾讯的 LatLng 定义为纬度在前。
                tencentLayer.setGeometries(points.map((point) => ({
                    id: point.id, position: new sdk.LatLng(point.latitude, point.longitude),
                })));
                const onClick = (event: {geometry?: {id?: unknown}}) => {
                    if (typeof event.geometry?.id === "string") {
                        click(event.geometry.id, nextRevision);
                    }
                };
                tencentLayer.on("click", onClick);
                removeMarkers.push(() => tencentLayer.off("click", onClick));
                return;
            }
            points.forEach((point) => {
                const onClick = () => click(point.id, nextRevision);
                if (provider === "openfreemap") {
                    const marker = new sdk.Marker().setLngLat([point.longitude, point.latitude]).addTo(map);
                    const element = marker.getElement();
                    element.addEventListener("click", onClick);
                    markers.push(marker);
                    removeMarkers.push(() => {
                        element.removeEventListener("click", onClick);
                        marker.remove();
                    });
                } else if (provider === "amap") {
                    const marker = new sdk.Marker({map, position: [point.longitude, point.latitude], draggable: false});
                    marker.on("click", onClick);
                    markers.push(marker);
                    removeMarkers.push(() => {
                        marker.off("click", onClick);
                        marker.setMap(null);
                    });
                } else {
                    const coordType = point.coordinateSystem === "gcj02" ?
                        baiduCoordinateTypes?.gcj02 : baiduCoordinateTypes?.bd09;
                    if (coordType === undefined) {
                        error();
                        return;
                    }
                    // 每个 Marker 显式声明坐标系，不依赖全局或地域默认值；不自行换算。
                    // https://lbs.baidu.com/jsapi/refdoc/v4/enums/BMap.CoordType.html
                    const options = {enableDragging: false, coordType};
                    const marker = new sdk.Marker(new sdk.Point(point.longitude, point.latitude), options);
                    map.addOverlay(marker);
                    marker.addEventListener("click", onClick);
                    markers.push(marker);
                    removeMarkers.push(() => {
                        marker.removeEventListener("click", onClick);
                        map.removeOverlay(marker);
                        marker.dispose?.();
                    });
                }
            });
        },
        fit: () => {
            if (destroyed || points.length === 0) {
                return;
            }
            if (provider === "openfreemap") {
                const bounds = new sdk.LngLatBounds();
                points.forEach((point) => bounds.extend([point.longitude, point.latitude]));
                map.fitBounds(bounds, {padding: 40, maxZoom: 15, duration: 0});
            } else if (provider === "amap") {
                map.setFitView(markers, true, [40, 40, 40, 40], 15);
            } else if (provider === "tencent") {
                const first = new sdk.LatLng(points[0].latitude, points[0].longitude);
                const bounds = new sdk.LatLngBounds(first, first);
                points.forEach((point) => bounds.extend(new sdk.LatLng(point.latitude, point.longitude)));
                map.fitBounds(bounds, {padding: 40, maxZoom: 15, ease: {duration: 0}});
            } else {
                // SDK 返回实际标注位置，混合输入坐标系不会被应用自行重新解释。
                map.setViewport(markers.map((marker) => marker.getPosition()),
                    {margins: [40, 40, 40, 40], enableAnimation: false});
            }
        },
        resize: () => {
            if (destroyed) {
                return;
            }
            if (provider === "openfreemap" || provider === "amap") {
                map.resize();
            } else if (provider === "baidu") {
                map.checkResize();
            }
            // 腾讯 SDK 自动响应容器尺寸变化，没有公开的 resize 方法。
        },
        setTheme: (theme) => {
            if (destroyed) {
                return;
            }
            container.ownerDocument.documentElement.dataset.theme = theme;
            if (provider === "amap") {
                map.setMapStyle(`amap://styles/${theme === "dark" ? "dark" : "normal"}`);
            } else if (provider === "baidu") {
                // 官方 4.0 的 setTheme 仅设置控件界面主题，底图仍使用服务默认样式。
                map.setTheme(theme);
            }
        },
        destroy: () => {
            if (destroyed) {
                return;
            }
            destroyed = true;
            removeReadyListener();
            cleanMarkers();
            points = [];
            if (provider === "openfreemap") {
                map.off("error", error);
                map.remove();
            } else if (provider === "amap") {
                map.off("error", error);
                map.destroy();
            } else if (provider === "tencent") {
                tencentLayer.setMap(null);
                map.destroy();
            } else {
                map.clearOverlays();
                map.destroy();
            }
            container.replaceChildren();
        },
    };
    return adapter;
};
