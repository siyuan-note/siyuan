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
const sanitizeMapPoints = value => {
    if (!Array.isArray(value)) return [];
    const ids = new Set();
    const points = [];
    for (const point of value.slice(0, 10000)) {
        if (!isRecord(point) || "coordinateSystem" in point || !isMapIdentifier(point.id) || ids.has(point.id) ||
            !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180 ||
            !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 85.0511287798066) continue;
        ids.add(point.id);
        points.push({id: point.id, longitude: point.longitude, latitude: point.latitude});
    }
    return points;
};
const parseMapCreate = value => {
    if (!isRecord(value) || value.version !== 1 || !isMapInstanceID(value.instanceID) ||
        value.provider !== "openfreemap" || !isMapTheme(value.theme)) return;
    return {version: 1, instanceID: value.instanceID, type: "init", provider: "openfreemap", theme: value.theme};
};
const parseMapCommand = (value, instanceID) => {
    if (!isRecord(value) || value.version !== 1 || value.instanceID !== instanceID) return;
    const base = {version: 1, instanceID};
    if (value.type === "visibility") {
        if (Object.keys(value).some(key => !["version", "instanceID", "type", "visible", "viewport"].includes(key)) ||
            typeof value.visible !== "boolean") return;
        if (!value.visible) return !Object.hasOwn(value, "viewport") ? {...base, type: "visibility", visible: false} : undefined;
        if (!Object.hasOwn(value, "viewport")) return {...base, type: "visibility", visible: true};
        const rect = value.viewport;
        if (!isRecord(rect) || Object.keys(rect).length !== 4 ||
            !["x", "y", "width", "height"].every(key => Object.hasOwn(rect, key) && Number.isFinite(rect[key]) && rect[key] >= 0 && rect[key] <= 32768) ||
            rect.width <= 0 || rect.height <= 0) return;
        return {...base, type: "visibility", visible: true, viewport: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}};
    }
    if (value.type === "setPoints" && isMapRevision(value.revision) && Array.isArray(value.points)) {
        return {...base, type: value.type, revision: value.revision, points: sanitizeMapPoints(value.points)};
    }
    if (value.type === "theme" && isMapTheme(value.theme)) return {...base, type: value.type, theme: value.theme};
    if (["resize", "destroy"].includes(value.type)) return {...base, type: value.type};
};
const parseMapReply = (value, instanceID) => {
    if (!isRecord(value) || value.version !== 1 || value.instanceID !== instanceID) return;
    const base = {version: 1, instanceID};
    if (["ready", "bootstrapReady"].includes(value.type)) return {...base, type: value.type};
    if (value.type === "markerClick" && isMapIdentifier(value.id) && isMapRevision(value.revision)) {
        return {...base, type: value.type, id: value.id, revision: value.revision};
    }
    if (value.type === "attributionClick" && ["openfreemap", "openmaptiles", "openstreetmap", "maplibre"].includes(value.link)) {
        return {...base, type: value.type, link: value.link};
    }
    if (value.type === "error" && ["unsupportedEnvironment", "invalidConfiguration",
        "hostUnavailable", "sdkUnavailable", "mapUnavailable", "sdkScriptLoadFailed",
        "sdkGlobalMissing", "mapCreationFailed", "mapReadyTimeout", "hostLimitReached", "hostSetupFailed",
        "hostAttachFailed", "hostDocumentLoadFailed", "hostDocumentLoadTimeout", "hostDocumentReloaded",
        "hostDocumentMismatch", "hostRendererGone", "hostDestroyed", "hostPortSetupFailed", "hostPortClosed",
        "hostBootstrapFailed", "hostBootstrapTimeout", "hostSDKTimeout", "hostOperationFailed", "hostCreateRejected",
        "hostCreateInvalidResponse", "hostReadyTimeout", "hostOwnerSetupFailed"].includes(value.code)) {
        return {...base, type: "error", code: value.code};
    }
};

const isAllowedMapProviderURL = value => {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password &&
            !url.port && !url.hash && url.hostname === "tiles.openfreemap.org";
    } catch (_error) {
        return false;
    }
};
const getMapRequestPolicy = (value, method, origin) => {
    try {
        if (!["GET", "HEAD"].includes(method) || typeof value !== "string" || value.length > 16384) return;
        const url = new URL(value);
        if (url.username || url.password) return;
        if (url.origin === origin) {
            if (!Object.hasOwn(mapHostFiles, url.pathname)) return;
            if (url.pathname === "/stage/map/index.html") {
                if (url.search !== "?provider=openfreemap") return;
            } else if (url.search) return;
            return {type: "local", file: mapHostFiles[url.pathname], document: url.pathname === "/stage/map/index.html"};
        }
        if (isAllowedMapProviderURL(value)) return {type: "provider"};
    } catch (_error) {
        return;
    }
};

const createMapContentSecurityPolicy = origin => {
    if (!normalizeMapOrigin(origin)) throw new Error("Invalid map origin");
    const assets = origin + "/stage/build/map/";
    const scripts = assets + "host.js " + assets + "maplibre-gl.js";
    const connect = "https://tiles.openfreemap.org " + assets + "maplibre-gl-csp-worker.js";
    const images = "data: blob: https://tiles.openfreemap.org";
    const styles = "'unsafe-inline' " + origin + "/stage/map/host.css " + assets + "maplibre-gl.css";
    return "default-src 'none'; sandbox allow-scripts; script-src " + scripts + "; connect-src " + connect +
        "; img-src " + images + "; style-src " + styles + "; font-src 'none'; worker-src blob:" +
        "; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
};

// 渲染器传入 CSS 像素，原生视图使用设备无关像素，不能再乘屏幕像素密度。
const parseMapGeometry = (value, zoom, contentBounds, report = () => {}) => {
    const reject = code => { report(code); return undefined; };
    if (!isRecord(value) || typeof value.visible !== "boolean") return reject("geometryInvalid");
    if (!value.visible) return {visible: false};
    if (!Number.isFinite(zoom) || zoom < 0.25 || zoom > 5 || !isRecord(value.bounds) ||
        !isRecord(value.logicalSize) || !isRecord(value.crop)) return reject("geometryInvalid");
    const {x, y, width, height} = value.bounds;
    const full = value.logicalSize;
    const crop = value.crop;
    const numbers = [x, y, width, height, full.width, full.height, crop.x, crop.y];
    if (!numbers.every(Number.isFinite) || numbers.some(number => number < 0 || number > 32768)) return reject("geometryInvalid");
    if (width < 1 || height < 1 || full.width < width || full.height < height) return reject("geometryLogicalBounds");
    if (crop.x + width > full.width + 1 || crop.y + height > full.height + 1) return reject("geometryCropBounds");
    if ((x + width) * zoom > contentBounds.width + 1 || (y + height) * zoom > contentBounds.height + 1) {
        return reject("geometryWindowBounds");
    }
    // 向内取整，避免原生视图绘制到可见 DOM 矩形之外。
    const left = Math.ceil(x * zoom), top = Math.ceil(y * zoom);
    const right = Math.floor((x + width) * zoom), bottom = Math.floor((y + height) * zoom);
    if (right <= left || bottom <= top) { report("geometryRoundedEmpty"); return {visible: false}; }
    return {visible: true, zoom, bounds: {x: left, y: top, width: right - left, height: bottom - top},
        logicalSize: {width: full.width, height: full.height},
        crop: {x: crop.x + left / zoom - x, y: crop.y + top / zoom - y}};
};

module.exports = {mapHostFiles, unsafeMapSwitches, hasUnsafeMapSwitches, normalizeMapOrigin,
    isMapInstanceID, parseMapCreate, parseMapCommand, parseMapReply, parseMapGeometry,
    isAllowedMapProviderURL, getMapRequestPolicy, createMapContentSecurityPolicy};
