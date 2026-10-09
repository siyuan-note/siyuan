// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

// 只读取固定打包资源，不解析渲染器提供的文件路径，也不代理任何内核请求。
const mapHostFiles = Object.freeze({
    "/stage/map/index.html": ["stage/map/index.html", "text/html; charset=utf-8"],
    "/stage/map/host.css": ["stage/map/host.css", "text/css; charset=utf-8"],
    "/stage/build/map/host.js": ["stage/build/map/host.js", "text/javascript; charset=utf-8"],
    "/stage/build/map/maplibre-gl.js": ["stage/build/map/maplibre-gl.js", "text/javascript; charset=utf-8"],
    "/stage/build/map/maplibre-gl.css": ["stage/build/map/maplibre-gl.css", "text/css; charset=utf-8"],
    "/stage/build/map/maplibre-gl-csp-worker.js": ["stage/build/map/maplibre-gl-csp-worker.js", "text/javascript; charset=utf-8"],
    "/stage/build/map/maplibre-LICENSE.txt": ["stage/build/map/maplibre-LICENSE.txt", "text/plain; charset=utf-8"],
});

const providerHosts = Object.freeze({
    openfreemap: ["tiles.openfreemap.org"],
    amap: ["webapi.amap.com", "restapi.amap.com", "vdata.amap.com", "a.amap.com", "*.is.autonavi.com"],
    tencent: ["map.qq.com", "apis.map.qq.com", "*.map.qq.com"],
    baidu: ["api.map.baidu.com", "*.map.bdimg.com", "*.bdimg.com", "*.map.baidu.com"],
});
// Electron 默认启用 allow-file-access-from-files；地图仅加载 HTTP(S) 文档，并由独立会话拒绝文件协议。
// 该开关只影响文件来源文档，不应误判为此地图宿主的安全绕过。
const unsafeMapSwitches = Object.freeze([
    "disable-web-security", "allow-running-insecure-content", "disable-site-isolation-for-policy",
    "disable-site-isolation-trials", "no-sandbox", "disable-setuid-sandbox", "disable-seccomp-filter-sandbox",
    "single-process", "allow-universal-access-from-files",
    "ignore-certificate-errors", "ignore-certificate-errors-spki-list", "ignore-ssl-errors",
    "ignore-ssl-errors-with-hosts", "allow-insecure-localhost",
]);
const unsafeDisabledFeatures = new Set(["isolateorigins", "site-per-process", "siteperprocess", "outofblinkcors"]);
const hasUnsafeMapSwitches = (commandLine) => unsafeMapSwitches.some(name => commandLine.hasSwitch(name)) ||
    (commandLine.getSwitchValue("disable-features") || "").toLowerCase().split(",")
        .some(name => unsafeDisabledFeatures.has(name.trim().split(/[<:]/, 1)[0]));

const isRecord = value => !!value && typeof value === "object" && !Array.isArray(value);
const isMapInstanceID = value => typeof value === "string" && /^[a-f0-9]{48}$/.test(value);
const isMapProvider = value => typeof value === "string" && Object.hasOwn(providerHosts, value);
const isMapTheme = value => value === "light" || value === "dark";
const isMapRevision = value => Number.isSafeInteger(value) && value >= 0;
const isMapIdentifier = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const normalizeMapOrigin = value => {
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin !== value) return;
        return url.origin;
    } catch (_error) {
        return;
    }
};
const sanitizeMapCredentials = (value, provider) => {
    const result = {};
    if (!isRecord(value) || provider === "openfreemap") return result;
    for (const key of provider === "amap" ? ["apiKey", "securityCode"] : ["apiKey"]) {
        const text = typeof value[key] === "string" ? value[key].trim() : "";
        if (text && Buffer.byteLength(text, "utf8") <= 4096) result[key] = text;
    }
    return result;
};
const sanitizeMapPoints = (value, provider) => {
    if (!Array.isArray(value)) return [];
    const ids = new Set();
    const points = [];
    for (const point of value.slice(0, 10000)) {
        if (!isRecord(point) || !isMapIdentifier(point.id) || ids.has(point.id) ||
            !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180 ||
            !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 ||
            (["openfreemap", "amap"].includes(provider) && Math.abs(point.latitude) > 85.0511287798066)) continue;
        const systems = provider === "openfreemap" ? ["wgs84"] : provider === "baidu" ? ["bd09", "gcj02"] : ["gcj02"];
        if (!systems.includes(point.coordinateSystem)) continue;
        ids.add(point.id);
        points.push({id: point.id, longitude: point.longitude, latitude: point.latitude, coordinateSystem: point.coordinateSystem});
    }
    return points;
};
const parseMapCreate = value => {
    if (!isRecord(value) || value.version !== 1 || !isMapInstanceID(value.instanceID) ||
        !isMapProvider(value.provider) || !isMapTheme(value.theme)) return;
    return {version: 1, instanceID: value.instanceID, type: "init", provider: value.provider,
        credentials: sanitizeMapCredentials(value.credentials, value.provider), theme: value.theme};
};
const parseMapCommand = (value, instanceID, provider) => {
    if (!isRecord(value) || value.version !== 1 || value.instanceID !== instanceID) return;
    const base = {version: 1, instanceID};
    if (value.type === "setPoints" && isMapRevision(value.revision) && Array.isArray(value.points)) {
        return {...base, type: value.type, revision: value.revision, points: sanitizeMapPoints(value.points, provider)};
    }
    if (value.type === "theme" && isMapTheme(value.theme)) return {...base, type: value.type, theme: value.theme};
    if (["fit", "resize", "destroy"].includes(value.type)) return {...base, type: value.type};
};
const parseMapReply = (value, instanceID) => {
    if (!isRecord(value) || value.version !== 1 || value.instanceID !== instanceID) return;
    const base = {version: 1, instanceID};
    if (["ready", "bootstrapReady"].includes(value.type)) return {...base, type: value.type};
    if (value.type === "markerClick" && isMapIdentifier(value.id) && isMapRevision(value.revision)) {
        return {...base, type: value.type, id: value.id, revision: value.revision};
    }
    if (value.type === "error" && ["unsupportedEnvironment", "missingCredentials", "invalidConfiguration",
        "hostUnavailable", "sdkUnavailable", "mapUnavailable"].includes(value.code)) {
        return {...base, type: "error", code: value.code};
    }
};

const isAllowedMapProviderURL = (value, provider) => {
    try {
        const url = new URL(value);
        return isMapProvider(provider) && url.protocol === "https:" && !url.username && !url.password &&
            !url.port && !url.hash && providerHosts[provider].some(host => host.startsWith("*.")
                ? url.hostname.endsWith(host.slice(1)) && url.hostname !== host.slice(2) : url.hostname === host);
    } catch (_error) {
        return false;
    }
};
const getMapRequestPolicy = (value, method, origin, provider) => {
    try {
        if (!["GET", "HEAD"].includes(method) || typeof value !== "string" || value.length > 16384) return;
        const url = new URL(value);
        if (url.username || url.password) return;
        if (url.origin === origin) {
            if (!Object.hasOwn(mapHostFiles, url.pathname)) return;
            if (url.pathname === "/stage/map/index.html") {
                if (url.search !== "?provider=" + provider) return;
            } else if (url.search) return;
            return {type: "local", file: mapHostFiles[url.pathname], document: url.pathname === "/stage/map/index.html"};
        }
        if (isAllowedMapProviderURL(value, provider)) return {type: "provider"};
    } catch (_error) {
        return;
    }
};

const createMapContentSecurityPolicy = (origin, provider) => {
    if (!normalizeMapOrigin(origin) || !isMapProvider(provider)) throw new Error("Invalid map origin or provider");
    const assets = origin + "/stage/build/map/";
    let scripts = assets + "host.js";
    let connect = "'none'";
    let images = "data: blob:";
    let styles = "'unsafe-inline' " + origin + "/stage/map/host.css";
    let workers = "'none'";
    if (provider === "openfreemap") {
        scripts += " " + assets + "maplibre-gl.js";
        connect = "https://tiles.openfreemap.org " + assets + "maplibre-gl-csp-worker.js";
        images += " https://tiles.openfreemap.org";
        styles += " " + assets + "maplibre-gl.css";
        workers = "blob:";
    } else if (provider === "amap") {
        scripts += " https://webapi.amap.com";
        connect = "https://webapi.amap.com https://restapi.amap.com https://vdata.amap.com";
        images += " https://webapi.amap.com https://a.amap.com https://*.is.autonavi.com";
    } else if (provider === "tencent") {
        scripts += " https://map.qq.com";
        connect = "https://map.qq.com https://apis.map.qq.com https://*.map.qq.com";
        images += " https://map.qq.com https://*.map.qq.com";
    } else {
        scripts += " https://api.map.baidu.com";
        connect = "https://api.map.baidu.com https://*.map.bdimg.com https://*.bdimg.com";
        images += " https://api.map.baidu.com https://*.map.bdimg.com https://*.bdimg.com https://*.map.baidu.com";
    }
    return "default-src 'none'; sandbox allow-scripts; script-src " + scripts + "; connect-src " + connect +
        "; img-src " + images + "; style-src " + styles + "; font-src 'none'; worker-src " + workers +
        "; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
};

// 渲染器传入 CSS 像素，原生视图使用设备无关像素，不能再乘屏幕像素密度。
const parseMapGeometry = (value, zoom, contentBounds) => {
    if (!isRecord(value) || typeof value.visible !== "boolean") return;
    if (!value.visible) return {visible: false};
    if (!Number.isFinite(zoom) || zoom < 0.25 || zoom > 5 || !isRecord(value.bounds) ||
        !isRecord(value.logicalSize) || !isRecord(value.crop)) return;
    const {x, y, width, height} = value.bounds;
    const full = value.logicalSize;
    const crop = value.crop;
    const numbers = [x, y, width, height, full.width, full.height, crop.x, crop.y];
    if (!numbers.every(Number.isFinite) || numbers.some(number => number < 0 || number > 32768) ||
        width < 1 || height < 1 || full.width < width || full.height < height ||
        crop.x + width > full.width + 1 || crop.y + height > full.height + 1 ||
        (x + width) * zoom > contentBounds.width + 1 || (y + height) * zoom > contentBounds.height + 1) return;
    // 向内取整，避免原生视图绘制到可见 DOM 矩形之外。
    const left = Math.ceil(x * zoom), top = Math.ceil(y * zoom);
    const right = Math.floor((x + width) * zoom), bottom = Math.floor((y + height) * zoom);
    if (right <= left || bottom <= top) return {visible: false};
    return {visible: true, zoom, bounds: {x: left, y: top, width: right - left, height: bottom - top},
        logicalSize: {width: full.width, height: full.height},
        crop: {x: crop.x + left / zoom - x, y: crop.y + top / zoom - y}};
};

module.exports = {mapHostFiles, providerHosts, unsafeMapSwitches, hasUnsafeMapSwitches, normalizeMapOrigin,
    isMapInstanceID, parseMapCreate, parseMapCommand, parseMapReply, parseMapGeometry,
    isAllowedMapProviderURL, getMapRequestPolicy, createMapContentSecurityPolicy};
