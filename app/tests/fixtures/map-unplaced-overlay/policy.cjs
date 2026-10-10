const ORIGIN = "https://siyuan-unplaced.invalid";
const CHANNEL = "siyuan-unplaced-fixture";
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
const parseState = value => {
    if (!keys(value, ["revision", "requestID", "query", "rows", "total", "page", "loading", "error", "theme", "labels"]) ||
        !isRevision(value.revision) || !isRevision(value.requestID) || !text(value.query, 256) || !integer(value.total, 1000000) ||
        !integer(value.page, 20) || typeof value.loading !== "boolean" || typeof value.error !== "boolean" ||
        !Array.isArray(value.rows) || value.rows.length > 500 || value.rows.length > value.total || value.rows.length > value.page * 50 ||
        !keys(value.theme, ["mode", "fontSize"]) || !["light", "dark"].includes(value.theme.mode) ||
        ![12, 14, 16, 18, 20, 24].includes(value.theme.fontSize)) return;
    const names = ["title", "search", "empty", "loading", "more", "retry", "close"];
    if (!keys(value.labels, names) || names.some(name => !text(value.labels[name], 120))) return;
    const ids = new Set();
    const rows = [];
    for (const row of value.rows) {
        if (!keys(row, ["id", "label"]) || !text(row.id, 128) || !row.id || !text(row.label, 2048) || ids.has(row.id)) return;
        ids.add(row.id);
        rows.push({id: row.id, label: row.label});
    }
    return {revision: value.revision, requestID: value.requestID, query: value.query, rows, total: value.total, page: value.page,
        loading: value.loading, error: value.error, theme: {...value.theme}, labels: {...value.labels}};
};
const parseAction = value => {
    if (!value || !isSession(value.sessionID) || !isRevision(value.revision)) return;
    const base = ["sessionID", "revision", "type"];
    if (["ready", "editing", "more"].includes(value.type) && keys(value, base)) return {...value};
    if (value.type === "search" && keys(value, [...base, "query"]) && text(value.query, 256)) return {...value};
    if (value.type === "select" && keys(value, [...base, "id"]) && text(value.id, 128) && value.id) return {...value};
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
const place = (anchor, zoom, bounds) => {
    if (!parseAnchor(anchor) || !Number.isFinite(zoom) || zoom < 0.25 || zoom > 5 ||
        bounds.width < 240 || bounds.height < 160) return;
    const a = {x: anchor.x * zoom, y: anchor.y * zoom, width: anchor.width * zoom, height: anchor.height * zoom};
    if (a.x < 0 || a.y < 0 || a.x + a.width > bounds.width || a.y + a.height > bounds.height) return;
    const width = Math.min(Math.round(320 * zoom), bounds.width);
    const height = Math.min(Math.round(360 * zoom), bounds.height);
    return {x: Math.max(0, Math.min(Math.round(a.x + a.width - width), bounds.width - width)),
        y: Math.max(0, Math.min(Math.round(a.y + a.height), bounds.height - height)), width, height};
};
const resource = (url, method) => {
    if (!["GET", "HEAD"].includes(method) || typeof url !== "string") return;
    const item = Object.entries(RESOURCES).find(([pathname]) => url === ORIGIN + pathname);
    return item?.[1];
};
module.exports = {ORIGIN, CHANNEL, RESOURCES, CSP, keys, isSession, parseState, parseAction, parseAnchor, place, resource};
