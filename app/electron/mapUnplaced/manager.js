const path = require("node:path");
const fs = require("node:fs/promises");
const {randomBytes} = require("node:crypto");
const {ORIGIN, CHANNEL, PAGE_SIZE, CSP, keys, parseTheme, parseState, parseAction, parseAnchor, place, resource} = require("./policy");

const deny = () => new Response("Forbidden", {status: 403});
const clearSession = ses => {
    for (const method of ["closeAllConnections", "clearStorageData", "clearAuthCache", "clearCache", "clearHostResolverCache"]) {
        try { void Promise.resolve(ses[method]()).catch(() => {}); } catch (_error) { /* 继续清理其他状态。 */ }
    }
};
const createRouter = (ses, assets, readFile = fs.readFile, onResourceFailure = () => {}) => {
    let destroyed = false, documentRequested = false;
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
    ses.setCertificateVerifyProc((_request, callback) => callback(-3));
    ses.allowNTLMCredentialsForDomains("");
    ses.on("will-download", event => event.preventDefault());
    ses.webRequest.onBeforeRequest((request, callback) => {
        const entry = resource(request.url, request.method);
        let allowed = !destroyed && entry && entry[2] === request.resourceType;
        if (request.resourceType === "mainFrame") {
            allowed = allowed && !documentRequested;
            if (allowed) documentRequested = true;
        }
        callback({cancel: !allowed});
    });
    ses.webRequest.onBeforeSendHeaders((_details, callback) => callback({cancel: destroyed, requestHeaders: {}}));
    const handle = async request => {
        const entry = resource(request.url, request.method);
        if (destroyed || !entry || request.headers.get("service-worker")) return deny();
        try {
            const body = entry[0] === "controls.css" ?
                assets.controls ?? await readFile(assets.controlsPath) : await readFile(path.join(__dirname, entry[0]));
            if (destroyed) return deny();
            return new Response(request.method === "HEAD" ? null : body, {headers: {
                "Content-Type": entry[1], "Content-Security-Policy": CSP, "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
                "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=(), usb=(), serial=(), bluetooth=()",
            }});
        } catch (_error) {
            if (!destroyed) onResourceFailure();
            return new Response("Not Found", {status: 404});
        }
    };
    ses.protocol.handle("https", handle);
    ses.protocol.handle("http", deny);
    ses.protocol.handle("file", deny);
    return {destroy() {
        if (destroyed) return;
        destroyed = true;
        clearSession(ses);
    }};
};

// 菜单只保留当前页的纯文本；真实查询、权限和最终行对象始终由可信 owner 管理。
const createManager = ({ipcMain, session, WebContentsView, owner, win, ownerURL, outsideContents = [], assets,
    onAction, onClose = () => {}, onVisibility = () => {}, mayUse = () => true, readFile,
    randomID = () => randomBytes(24).toString("hex"), handleActions = true}) => {
    let host, disposed = false;
    const ownerFrame = owner.mainFrame;
    const listeners = [];
    const listen = (emitter, name, fn, list = listeners) => {
        const guarded = (...args) => {
            try { fn(...args); } catch (_error) { close("operation-failed"); }
        };
        emitter.on(name, guarded);
        list.push([emitter, name, guarded]);
    };
    const currentOwner = () => !disposed && !owner.isDestroyed() && !win.isDestroyed() &&
        owner.mainFrame === ownerFrame && ownerFrame.url === ownerURL;
    const trusted = event => currentOwner() && event?.sender === owner && event.senderFrame === owner.mainFrame;
    const permitted = () => { try { return mayUse() === true; } catch (_error) { return false; } };
    const close = (reason, restore = false, notify = true) => {
        const previous = host;
        if (!previous) return;
        host = undefined;
        clearTimeout(previous.timer);
        previous.ids.clear();
        previous.state.rows = [];
        for (const [emitter, name, fn] of previous.listeners) emitter.removeListener(name, fn);
        previous.router.destroy();
        try { if (!win.isDestroyed()) win.contentView.removeChildView(previous.view); } catch (_error) { /* 继续关闭渲染器。 */ }
        const contents = previous.view.webContents;
        if (!contents.isDestroyed()) {
            try { contents.stop(); } catch (_error) { /* 继续关闭渲染器。 */ }
            try { contents.close({waitForBeforeUnload: false}); } catch (_error) { /* 渲染器可能已关闭。 */ }
        }
        if (previous.ready) onVisibility(false);
        if (restore && currentOwner() && win.isFocused()) {
            try { owner.focus(); } catch (_error) { /* 关闭仍然完成，不抢其他窗口焦点。 */ }
        }
        if (notify) onClose({sessionID: previous.sessionID, reason, restore});
    };
    const geometry = () => {
        if (!host) return false;
        if (!currentOwner()) { close("owner-unavailable"); return false; }
        const zoom = owner.getZoomFactor();
        const bounds = place(host.anchor, zoom, win.getContentBounds());
        if (!permitted() || !win.isVisible() || win.isMinimized?.() || !bounds) { close("unavailable"); return false; }
        const key = JSON.stringify({bounds, zoom});
        if (host.geometryKey !== key) {
            host.view.webContents.setZoomFactor(zoom);
            host.view.setBounds(bounds);
            host.geometryKey = key;
        }
        return true;
    };
    const sendState = () => {
        if (host?.ready) host.view.webContents.send(CHANNEL + "-state", {sessionID: host.sessionID, state: host.state});
    };
    const stateIDs = state => new Set(state.loading || state.error ? [] : state.rows.map(row => row.id));
    const open = (event, value) => {
        if (!trusted(event) || !permitted() || !keys(value, ["state", "anchor"])) return;
        const state = parseState(value.state), anchor = parseAnchor(value.anchor);
        if (!state || state.requestID !== 0 || !anchor || !place(anchor, owner.getZoomFactor(), win.getContentBounds())) return;
        close("replace");
        const sessionID = randomID();
        let ses, router, view;
        try {
            ses = session.fromPartition("siyuan-map-unplaced-" + sessionID, {cache: false});
            router = createRouter(ses, assets, readFile, () => { if (host?.sessionID === sessionID) close("resource-failed"); });
            view = new WebContentsView({webPreferences: {session: ses, preload: path.join(__dirname, "preload.js"),
                additionalArguments: ["--unplaced-session=" + sessionID], nodeIntegration: false,
                nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true,
                webSecurity: true, webviewTag: false, allowRunningInsecureContent: false, devTools: false,
                navigateOnDragDrop: false, safeDialogs: true, disableDialogs: true, spellcheck: false}});
            host = {sessionID, view, router, state, anchor, ids: stateIDs(state), ready: false, listeners: [],
                pending: state.loading, query: state.query, page: state.page, requestID: 0};
            const active = host;
            const contents = view.webContents;
            contents.setWindowOpenHandler(() => ({action: "deny"}));
            for (const name of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
                listen(contents, name, event => event.preventDefault(), host.listeners);
            }
            listen(contents, "login", (event, _details, _info, callback) => { event.preventDefault(); callback(); }, host.listeners);
            listen(contents, "select-client-certificate", (event, _url, _certificates, callback) => { event.preventDefault(); callback(); }, host.listeners);
            listen(contents, "certificate-error", (_event, _url, _error, _certificate, callback) => callback(false), host.listeners);
            listen(contents, "did-finish-load", () => {
                if (active.loaded || contents.getURL() !== ORIGIN + "/menu.html") { close("document-mismatch"); return; }
                active.loaded = true;
            }, host.listeners);
            for (const name of ["render-process-gone", "destroyed", "did-fail-load"]) {
                listen(contents, name, () => { if (host === active) close("renderer-failed"); }, host.listeners);
            }
            host.timer = setTimeout(() => { if (host === active) close("ready-timeout"); }, 10000);
            host.timer.unref?.();
            view.setVisible(false);
            win.contentView.addChildView(view);
            if (!geometry()) return;
            void contents.loadURL(ORIGIN + "/menu.html").catch(() => { if (host === active) close("load-failed"); });
            return sessionID;
        } catch (_error) {
            if (host?.sessionID === sessionID) close("setup-failed");
            else {
                if (router) router.destroy(); else if (ses) clearSession(ses);
                try { if (view && !view.webContents.isDestroyed()) view.webContents.close({waitForBeforeUnload: false}); } catch (_failure) { /* 保留拒绝网络策略。 */ }
            }
        }
    };
    const update = (event, value) => {
        if (!trusted(event) || !host || !keys(value, ["sessionID", "state"]) || value.sessionID !== host.sessionID) return false;
        if (!permitted()) { close("permission-revoked"); return false; }
        const state = parseState(value.state);
        if (!state || state.revision <= host.state.revision || state.requestID !== host.requestID ||
            state.query !== host.query || state.page !== host.page) return false;
        host.state = state;
        host.ids = stateIDs(state);
        host.pending = state.loading;
        sendState();
        return true;
    };
    const setAnchor = (event, value) => {
        if (!trusted(event) || !host || !keys(value, ["sessionID", "anchor"]) || value.sessionID !== host.sessionID) return false;
        const anchor = parseAnchor(value.anchor);
        if (!anchor) return false;
        host.anchor = anchor;
        return geometry();
    };
    const setTheme = (event, value) => {
        if (!trusted(event) || !host || !keys(value, ["sessionID", "theme"]) || value.sessionID !== host.sessionID) return false;
        if (!permitted()) { close("permission-revoked"); return false; }
        const theme = parseTheme(value.theme);
        if (!theme) return false;
        // 主题更新不推进数据 revision，避免已发出的编辑、翻页和选择动作变成过期消息。
        host.state.theme = theme;
        if (host.ready) host.view.webContents.send(CHANNEL + "-theme", {sessionID: host.sessionID, theme});
        return true;
    };
    const message = (event, value) => {
        if (host && !currentOwner()) { close("owner-unavailable"); return; }
        const action = parseAction(value);
        if (!host || !action || event.sender !== host.view.webContents || event.senderFrame !== event.sender.mainFrame ||
            event.senderFrame.url !== ORIGIN + "/menu.html" || action.sessionID !== host.sessionID) return;
        if (!permitted()) { close("permission-revoked"); return; }
        if (action.type === "ready") {
            if (host.ready || action.revision !== 0) return;
            host.ready = true;
            clearTimeout(host.timer);
            sendState();
            if (geometry()) { host.view.setVisible(true); onVisibility(true); host.view.webContents.focus(); }
            return;
        }
        if (!host.ready || action.revision !== host.state.revision) return;
        if (action.type === "close") { close(action.reason, true); return; }
        if (action.type === "editing") {
            host.ids.clear();
            host.pending = true;
            host.query = undefined;
            onAction({...action, requestID: ++host.requestID});
            return;
        }
        if (action.type === "select") {
            if (!host.ids.has(action.id)) return;
            const requestID = host.requestID;
            // 选择是唯一终止消息；owner 必须先取回私有行对象，再清理自己的会话状态。
            close("select", true, false);
            onAction({...action, requestID});
            return;
        }
        if (action.type !== "search" && host.pending) return;
        if (action.type === "more" && (host.state.error || host.state.page * PAGE_SIZE >= host.state.total)) return;
        if (action.type === "previous" && host.state.page <= 1 || action.type === "retry" && !host.state.error) return;
        host.ids.clear();
        host.pending = true;
        host.query = action.type === "search" ? action.query.trim() : host.state.query;
        host.page = action.type === "search" ? 1 : host.state.page + (action.type === "more" ? 1 : action.type === "previous" ? -1 : 0);
        onAction({...action, query: host.query, page: host.page, requestID: ++host.requestID});
    };
    if (handleActions) listen(ipcMain, CHANNEL + "-action", message);
    const outside = (_event, input) => { if (input.type === "mouseDown") close("outside"); };
    for (const contents of outsideContents) listen(contents, "before-mouse-event", outside);
    for (const name of ["blur", "hide", "minimize", "closed"]) listen(win, name, () => close("window-" + name));
    for (const name of ["resize", "move"]) listen(win, name, geometry);
    listen(owner, "zoom-changed", geometry);
    for (const name of ["will-navigate", "destroyed", "render-process-gone"]) listen(owner, name, () => close("owner-" + name));
    listen(owner, "did-start-navigation", details => { if (details.isMainFrame) close("owner-navigation"); });
    return {open, update, setAnchor, setTheme, action: message,
        close(event, value) {
            if (trusted(event) && host && keys(value, ["sessionID", "reason"]) && value.sessionID === host.sessionID &&
                ["outside", "button", "anchor-hidden"].includes(value.reason)) close(value.reason, value.reason === "button");
        },
        revoke() { close("permission-revoked"); },
        dismiss(reason = "outside") { close(reason); },
        promote() {
            if (!host || !currentOwner() || !permitted()) return;
            try { win.contentView.addChildView(host.view); } catch (_error) { close("operation-failed"); }
        },
        destroy() {
            if (disposed) return;
            close("destroy");
            disposed = true;
            for (const [emitter, name, fn] of listeners) emitter.removeListener(name, fn);
        },
        // 仅供主进程测试读取，不通过 renderer 桥暴露。
        inspect: () => host && {sessionID: host.sessionID, view: host.view, ready: host.ready},
    };
};
module.exports = {createRouter, createManager};
