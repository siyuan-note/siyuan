const ORIGIN = "https://siyuan-unplaced.invalid";
const CHANNEL = "siyuan-map-unplaced-menu";
const PAGE_SIZE = 50;
const RESOURCES = Object.freeze({
    "/menu.html": ["menu.html", "text/html; charset=utf-8", "mainFrame"],
    "/menu.js": ["menu.js", "text/javascript; charset=utf-8", "script"],
    "/menu.css": ["menu.css", "text/css; charset=utf-8", "stylesheet"],
    "/controls.css": ["controls.css", "text/css; charset=utf-8", "stylesheet"],
});
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; " +
    "font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const keys = (value, names) => !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const text = (value, max) => typeof value === "string" && value.length <= max && !value.includes("\0");
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const isSession = value => typeof value === "string" && /^[a-f0-9]{48}$/.test(value);
const isRevision = value => integer(value, Number.MAX_SAFE_INTEGER);
const parseTheme = value => keys(value, ["mode", "fontSize"]) && ["light", "dark"].includes(value.mode) &&
    integer(value.fontSize, 32) && value.fontSize >= 12 ? {...value} : undefined;
const parseState = value => {
    if (!keys(value, ["revision", "requestID", "query", "rows", "total", "page", "loading", "error", "theme", "labels"]) ||
        !isRevision(value.revision) || !isRevision(value.requestID) || !text(value.query, 256) || !isRevision(value.total) ||
        !integer(value.page, Math.ceil(Number.MAX_SAFE_INTEGER / PAGE_SIZE)) || value.page < 1 ||
        typeof value.loading !== "boolean" || typeof value.error !== "boolean" ||
        !Array.isArray(value.rows) || value.rows.length > PAGE_SIZE || value.rows.length > value.total ||
        !parseTheme(value.theme)) return;
    const names = ["title", "search", "empty", "loading", "more", "previous", "retry", "close"];
    if (!keys(value.labels, names) || names.some(name => !text(value.labels[name], 120))) return;
    const ids = new Set();
    const rows = [];
    for (const row of value.rows) {
        if (!keys(row, ["id", "title"]) || !text(row.id, 128) || !row.id || !text(row.title, 2048) || ids.has(row.id)) return;
        ids.add(row.id);
        rows.push({id: row.id, title: row.title});
    }
    return {revision: value.revision, requestID: value.requestID, query: value.query, rows, total: value.total, page: value.page,
        loading: value.loading, error: value.error, theme: {...value.theme}, labels: {...value.labels}};
};
const parseAction = value => {
    if (!value || !isSession(value.sessionID) || !isRevision(value.revision)) return;
    const base = ["sessionID", "revision", "type"];
    if (["ready", "editing", "more", "previous", "retry"].includes(value.type) && keys(value, base)) return {...value};
    if (value.type === "search" && keys(value, [...base, "query"]) && text(value.query, 256)) return {...value};
    if (value.type === "select" && keys(value, [...base, "id"]) && text(value.id, 128) && value.id) return {...value};
    if (value.type === "resize" && keys(value, [...base, "height"]) && integer(value.height, 4096) && value.height >= 50) return {...value};
    if (value.type === "close" && keys(value, [...base, "reason"]) &&
        ["escape", "button"].includes(value.reason)) return {...value};
};
const parseAnchor = value => {
    if (!keys(value, ["x", "y", "width", "height"]) ||
        Object.values(value).some(n => !Number.isFinite(n) || Math.abs(n) > 100000) ||
        value.width <= 0 || value.height <= 0) return;
    return {...value};
};
// 缩放取主进程的真实 WebContents 值，锚点以 owner 的 CSS 像素表示。
const place = (anchor, zoom, bounds, preferredHeight = 408) => {
    if (!parseAnchor(anchor) || !Number.isFinite(zoom) || zoom < 0.25 || zoom > 5 ||
        !integer(preferredHeight, 4096) || preferredHeight < 50 || bounds.width < 240 || bounds.height < 160) return;
    const a = {x: anchor.x * zoom, y: anchor.y * zoom, width: anchor.width * zoom, height: anchor.height * zoom};
    if (a.x < 0 || a.y < 0 || a.x + a.width > bounds.width || a.y + a.height > bounds.height) return;
    const padding = Math.round(24 * zoom);
    const width = Math.min(Math.round(368 * zoom), bounds.width);
    const height = Math.min(Math.round(preferredHeight * zoom), Math.round(568 * zoom),
        Math.floor(bounds.height * 0.65) + 2 * padding, bounds.height);
    return {x: Math.max(0, Math.min(Math.round(a.x + a.width - width + padding), bounds.width - width)),
        y: Math.max(0, Math.min(Math.round(a.y + a.height - padding), bounds.height - height)), width, height};
};
const resource = (url, method) => {
    if (!["GET", "HEAD"].includes(method) || typeof url !== "string") return;
    const item = Object.entries(RESOURCES).find(([pathname]) => url === ORIGIN + pathname);
    return item?.[1];
};
module.exports = {ORIGIN, CHANNEL, PAGE_SIZE, RESOURCES, CSP, keys, isSession, parseTheme, parseState, parseAction, parseAnchor, place, resource};
