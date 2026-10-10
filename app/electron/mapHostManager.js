// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

const path = require("node:path");
const fs = require("node:fs/promises");
const {randomBytes} = require("node:crypto");
const {createManager: createUnplacedManager} = require("./mapUnplaced/manager");
const {CHANNEL: UNPLACED_CHANNEL, keys: hasUnplacedKeys} = require("./mapUnplaced/policy");
const {hardenMapWebviewPreferences, isMapWebviewAttachment, getMapWebviewPreferenceMismatch} = require("./mapWebviewHost");
const {mapDiagnosticCodes, mapCSPDiagnosticCodes, isMapCSPResource, MAX_MAP_DIAGNOSTICS, classifyMapConsoleMessage,
    classifyMapCSPResources} = require("./mapHostDiagnostics");
const {
    hasUnsafeMapSwitches, normalizeMapOrigin, parseMapCreate, parseMapCommand, parseMapReply, parseMapGeometry,
    isAllowedMapProviderURL, getMapRequestPolicy, createMapContentSecurityPolicy,
} = require("./mapHostPolicy");

// 资源准备包含文档、打包资源和 CSP 锁定；地图就绪从 bootstrapReady 起另计有限预算。
const MAP_HOST_BOOTSTRAP_TIMEOUT = 30000;
const MAP_HOST_READY_TIMEOUT = 45000;

const deniedResponse = () => new Response("Forbidden", {status: 403,
    headers: {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}});
const withoutCredentials = (headers) => Object.fromEntries(Object.entries(headers || {})
    .filter(([name]) => !["cookie", "authorization", "proxy-authorization"].includes(name.toLowerCase())));
const clearMapSession = ses => {
    for (const method of ["closeAllConnections", "clearStorageData", "clearAuthCache", "clearCache", "clearHostResolverCache"]) {
        try { void Promise.resolve(ses[method]()).catch(() => {}); } catch (_error) { /* 继续清理其他会话状态。 */ }
    }
};

// 此会话从不向任何内核发送网络请求，包括未设置密码的本机内核。
const createMapSessionRouter = ({ses, origin, appDir, readFile = fs.readFile, trackFetch = () => {}, report = () => {}}) => {
    let destroyed = false;
    let documentRequested = false;
    const requests = new Set();
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
    ses.setCertificateVerifyProc((_request, callback) => callback(-3));
    ses.allowNTLMCredentialsForDomains("");
    ses.on("will-download", event => event.preventDefault());
    ses.webRequest.onBeforeRequest((details, callback) => {
        const policy = getMapRequestPolicy(details.url, details.method, origin);
        let allowed = !destroyed && !!policy;
        if (details.resourceType === "mainFrame") {
            allowed = allowed && policy.type === "local" && policy.document && !documentRequested;
            if (allowed) documentRequested = true;
        } else if (details.resourceType === "subFrame" || details.resourceType === "webSocket") {
            allowed = false;
        } else if (!destroyed && /^(blob:|data:)/.test(details.url)) {
            // 仅允许无网络权限的图片数据，以及本地预载后创建的 CSP worker。
            allowed = ["image", "other"].includes(details.resourceType);
        }
        if (!allowed && !destroyed) {
            report(details.url.startsWith("http:") && !details.url.startsWith(origin + "/") ?
                "providerInsecureRequest" : "providerRequestDenied");
        }
        callback({cancel: !allowed});
    });
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
        callback({cancel: destroyed, requestHeaders: withoutCredentials(details.requestHeaders)});
    });
    ses.webRequest.onHeadersReceived((details, callback) => {
        const responseHeaders = Object.fromEntries(Object.entries(details.responseHeaders || {})
            .filter(([name]) => !["set-cookie", "set-cookie2"].includes(name.toLowerCase())));
        callback({cancel: destroyed, responseHeaders});
    });
    const handle = async (request) => {
        const policy = !destroyed && getMapRequestPolicy(request.url, request.method, origin);
        if (!policy || request.headers.get("service-worker")) return deniedResponse();
        if (policy.type === "local") {
            try {
                const data = await readFile(path.join(appDir, policy.file[0]));
                if (destroyed) return deniedResponse();
                const headers = {"Content-Type": policy.file[1], "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*",
                    "Referrer-Policy": "strict-origin-when-cross-origin",
                    "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=(), usb=(), serial=(), bluetooth=()"};
                if (policy.document) headers["Content-Security-Policy"] = createMapContentSecurityPolicy(origin);
                return new Response(request.method === "HEAD" ? null : data, {headers});
            } catch (_error) {
                report("assetUnavailable");
                return new Response("Not Found", {status: 404});
            }
        }
        const abort = new AbortController();
        requests.add(abort);
        const timer = setTimeout(() => abort.abort(), 30000);
        timer.unref?.();
        const abortRequest = () => abort.abort();
        request.signal?.addEventListener("abort", abortRequest, {once: true});
        if (request.signal?.aborted) abort.abort();
        let activeURL;
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            request.signal?.removeEventListener("abort", abortRequest);
            if (activeURL) trackFetch(activeURL, -1);
            requests.delete(abort);
        };
        abort.signal.addEventListener("abort", finish, {once: true});
        try {
            let url = request.url;
            for (let redirects = 0; redirects <= 5; redirects++) {
                if (destroyed || abort.signal.aborted) break;
                if (!isAllowedMapProviderURL(url)) {
                    report(url.startsWith("http:") ? "providerInsecureRequest" : "providerRequestDenied");
                    break;
                }
                if (activeURL) trackFetch(activeURL, -1);
                activeURL = url;
                trackFetch(activeURL, 1);
                // 不复制浏览器凭证或任意请求头；来源只保留内核来源，不携带笔记路径。
                const headers = {"Referer": origin + "/"};
                for (const name of ["accept", "accept-language", "range"]) {
                    const value = request.headers.get(name);
                    if (value && value.length <= 4096) headers[name] = value;
                }
                const response = await ses.fetch(url, {method: request.method, headers, credentials: "omit",
                    cache: "no-store", redirect: "manual", bypassCustomProtocolHandlers: true, signal: abort.signal});
                if (response.status >= 400) report("providerHTTPFailure");
                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    const location = response.headers.get("location");
                    await response.body?.cancel();
                    if (!location) break;
                    url = new URL(location, url).href;
                    continue;
                }
                if (destroyed || abort.signal.aborted) {
                    await response.body?.cancel();
                    break;
                }
                const responseHeaders = new Headers(response.headers);
                for (const name of ["set-cookie", "set-cookie2", "www-authenticate", "proxy-authenticate", "refresh", "location"]) {
                    responseHeaders.delete(name);
                }
                responseHeaders.set("Cache-Control", "no-store");
                if (!response.body || request.method === "HEAD") {
                    await response.body?.cancel();
                    finish();
                    return new Response(null, {status: response.status, headers: responseHeaders});
                }
                const reader = response.body.getReader();
                const body = new ReadableStream({
                    async pull(controller) {
                        try {
                            const {done, value} = await reader.read();
                            if (destroyed || abort.signal.aborted) throw new Error("Map request closed");
                            if (done) { controller.close(); finish(); } else controller.enqueue(value);
                        } catch (error) {
                            if (!destroyed && !abort.signal.aborted) report("providerNetworkFailure");
                            controller.error(error); finish();
                        }
                    },
                    async cancel() { abort.abort(); await reader.cancel().catch(() => {}); finish(); },
                });
                return new Response(body, {status: response.status, headers: responseHeaders});
            }
        } catch (_error) {
            // 请求地址可能包含私有数据，不记录请求地址或异常文本。
            if (!destroyed && !abort.signal.aborted) report("providerNetworkFailure");
        }
        finish();
        return deniedResponse();
    };
    ses.protocol.handle("http", handle);
    ses.protocol.handle("https", handle);
    ses.protocol.handle("file", deniedResponse);
    return {
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            for (const request of requests) request.abort();
            requests.clear();
            // Electron 没有 Session.destroy；清理状态后仍保留拒绝处理器，阻止残留请求恢复访问。
            clearMapSession(ses);
        },
    };
};

const createMapHostManager = ({app, ipcMain, session, BrowserWindow, WebContentsView, MessageChannelMain,
    getTarget, isInitialized, appDir, readFile, randomID = () => randomBytes(24).toString("hex")}) => {
    const hosts = new Map();
    const attachmentOwners = new WeakSet();
    const webviewSessions = new WeakSet();
    const mapContents = new Set();
    const activeFetchURLs = new Map();
    const trackFetch = (url, delta) => {
        const count = (activeFetchURLs.get(url) || 0) + delta;
        if (count <= 0) activeFetchURLs.delete(url); else activeFetchURLs.set(url, count);
    };
    const isMapAuthentication = (contents, url) => contents ? mapContents.has(contents.id) : activeFetchURLs.has(String(url));
    // Session.fetch 的客户端证书事件可能只在 app 触发，且 WebContents 为空。
    app.on("select-client-certificate", (event, contents, url, _certificates, callback) => {
        if (!contents && isMapAuthentication(contents, url)) { event.preventDefault(); callback(); }
    });
    app.on("login", (event, contents, details, _authInfo, callback) => {
        if (!contents && isMapAuthentication(contents, details.url)) { event.preventDefault(); callback(); }
    });
    // 返回固定诊断码，不暴露地址或启动参数值；所有宿主入口复用相同信任检查。
    const inspectOwner = event => {
        if (!event?.sender || event.sender.isDestroyed()) return {reason: "ownerUnavailable"};
        if (event.senderFrame !== event.sender.mainFrame) return {reason: "notMainFrame"};
        if (!isInitialized(event.sender.id)) return {reason: "notInitialized"};
        const target = getTarget(event.sender.id);
        if (!target || !["local", "remote"].includes(target.mode)) return {reason: "unregisteredOwner"};
        const origin = normalizeMapOrigin(target.origin);
        if (!origin) return {reason: "invalidKernelOrigin"};
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win || win.isDestroyed()) return {reason: "ownerUnavailable"};
        try {
            const url = new URL(event.senderFrame.url);
            if (url.origin !== origin) return {reason: "originMismatch"};
            if (!["/stage/build/app/", "/stage/build/app/window.html"].includes(url.pathname)) {
                return {reason: "unsupportedDocument"};
            }
        } catch (_error) { return {reason: "invalidDocument"}; }
        return {owner: {win, origin, mode: target.mode === "local" ? "webview" : "native"}};
    };
    const trustedOwner = event => inspectOwner(event).owner;
    const getHost = (event, value) => {
        const owner = trustedOwner(event);
        if (!owner || value?.version !== 1 || typeof value.instanceID !== "string") return;
        const host = hosts.get(event.sender.id + ":" + value.instanceID);
        if (host && !host.destroyed && host.owner === event.sender && host.win === owner.win &&
            host.origin === owner.origin && host.mode === owner.mode && host.frame === event.senderFrame) return host;
    };
    const sendOwner = (host, reply) => {
        if (!host.destroyed && !host.owner.isDestroyed()) {
            try { host.owner.send("siyuan-map-reply", reply); } catch (_error) { destroy(host); }
        }
    };
    const setVisible = (host, visible, updateNative = true) => {
        if (host.mode === "webview") {
            host.visible = visible && host.ready && host.win.isVisible() && !host.win.isMinimized();
            if (!host.visible) host.attributionGestureUntil = 0;
            const visibility = host.visible ? host.visibility : {visible: false};
            const key = JSON.stringify(visibility);
            if (host.ready && key !== host.lastVisibility) {
                host.lastVisibility = key;
                post(host, {version: 1, instanceID: host.init.instanceID, type: "visibility", ...visibility});
            }
            return;
        }
        if (updateNative && !host.view.webContents.isDestroyed()) host.view.setVisible(visible);
        if (!visible) host.attributionGestureUntil = 0;
        host.visible = visible;
        // 原生视口已裁剪并平移 #map，此处不能再次叠加 crop。
        const obscured = [...hosts.values()].some(item => item.win === host.win && item.unplaced?.inspect()?.ready);
        // 可信菜单独立叠在原生地图之上，保留地图绘制，但遮挡期间不能累计署名可见时间。
        if (obscured) host.attributionGestureUntil = 0;
        const visibility = visible ? {visible: true, ...(!obscured && {viewport: {x: 0, y: 0,
            width: host.geometry.bounds.width / host.geometry.zoom, height: host.geometry.bounds.height / host.geometry.zoom}})} :
            {visible: false};
        const key = JSON.stringify(visibility);
        if (host.ready && key !== host.lastVisibility) {
            host.lastVisibility = key;
            post(host, {version: 1, instanceID: host.init.instanceID, type: "visibility", ...visibility});
        }
    };
    const hide = host => {
        host.unplaced?.dismiss("map-hidden");
        host.geometry = undefined;
        setVisible(host, false);
    };
    const destroy = host => {
        if (!host || host.destroyed) return;
        host.destroyed = true;
        host.unplaced?.destroy();
        clearTimeout(host.timer);
        hosts.delete(host.key);
        for (const [emitter, name, listener] of host.listeners) emitter.removeListener(name, listener);
        host.ids.clear();
        host.points = undefined;
        host.router.destroy();
        for (const port of [host.port, host.transferredPort]) {
            try { port?.close(); } catch (_error) { /* 端口已转移或关闭。 */ }
        }
        try {
            if (host.view && !host.win.isDestroyed()) host.win.contentView.removeChildView(host.view);
        } catch (_error) { /* 移除失败也必须关闭渲染器。 */ }
        // 移除视图不会销毁 WebContents，必须实际关闭 SDK 渲染器。
        if (host.contents && !host.contents.isDestroyed()) {
            try { host.contents.stop(); } catch (_error) { /* 仍尝试关闭。 */ }
            try { host.contents.close({waitForBeforeUnload: false}); } catch (_error) { /* 渲染器可能已关闭。 */ }
        }
        if (host.contents) mapContents.delete(host.contents.id);
    };
    const fail = (host, code) => {
        if (!host || host.destroyed) return;
        sendOwner(host, {version: 1, instanceID: host.init.instanceID, type: "error", code});
        destroy(host);
    };
    const setDeadline = (host, milliseconds) => {
        clearTimeout(host.timer);
        host.timer = setTimeout(() => {
            const code = !host.loaded ? "hostDocumentLoadTimeout" : host.bootstrapped ? "hostSDKTimeout" : "hostBootstrapTimeout";
            fail(host, code);
        }, milliseconds);
        host.timer.unref?.();
    };
    const listen = (host, emitter, name, listener) => {
        const guarded = (...args) => {
            if (host.destroyed) return;
            try { listener(...args); } catch (_error) { fail(host, "hostOperationFailed"); }
        };
        host.listeners.push([emitter, name, guarded]);
        emitter.on(name, guarded);
    };
    const post = (host, message) => {
        if (!host.destroyed && host.port) {
            try { host.port.postMessage(message); } catch (_error) { fail(host, "hostOperationFailed"); }
        }
    };
    const applyGeometry = host => {
        if (host.mode === "webview") {
            setVisible(host, host.visibility?.visible === true, false);
            return;
        }
        const geometry = host.geometry;
        if (!geometry?.visible || host.destroyed) return;
        // SDK 初始化也需要非零尺寸；设置已校验的几何不等于允许显示原生视图。
        host.view.webContents.setZoomFactor(geometry.zoom);
        host.view.setBounds(geometry.bounds);
        if (host.loaded) {
            host.view.webContents.send("siyuan-map-viewport", {logicalSize: geometry.logicalSize, crop: geometry.crop});
        }
        if (!host.ready || !host.win.isVisible() || host.win.isMinimized()) {
            setVisible(host, false);
            return;
        }
        setVisible(host, true);
        post(host, {version: 1, instanceID: host.init.instanceID, type: "resize"});
    };
    const dismissUnplaced = (win, reason) => {
        for (const host of hosts.values()) if (host.win === win) host.unplaced?.dismiss(reason);
    };
    const refreshMenuVisibility = win => {
        for (const host of hosts.values()) {
            if (host.win !== win || host.destroyed) continue;
            host.attributionGestureUntil = 0;
            if (host.geometry) setVisible(host, host.visible, false);
        }
    };
    const unplacedFor = host => {
        if (host.mode !== "native") return;
        if (host.unplaced) return host.unplaced;
        const send = value => {
            if (host.owner.isDestroyed() || host.frame !== host.owner.mainFrame) return;
            try { host.owner.send("siyuan-map-unplaced-reply", {version: 1, instanceID: host.init.instanceID, ...value}); }
            catch (_error) { host.unplaced?.dismiss("owner-unavailable"); }
        };
        host.unplaced = createUnplacedManager({ipcMain, session, WebContentsView, owner: host.owner, win: host.win,
            ownerURL: host.frame.url, assets: {controlsPath: path.join(appDir, "stage/build/map/unplaced-controls.css")},
            randomID, readFile, handleActions: false,
            mayUse: () => getHost({sender: host.owner, senderFrame: host.frame}, host.init) === host && host.ready &&
                host.visible && !host.view.webContents.isDestroyed() && !hasUnsafeMapSwitches(app.commandLine),
            onAction: ({type, ...action}) => send({type: "action", action: type, ...action}),
            onClose: value => send({type: "closed", ...value}),
            onVisibility: () => refreshMenuVisibility(host.win)});
        return host.unplaced;
    };
    ipcMain.handle("siyuan-map-unplaced-open", (event, value) => {
        const host = getHost(event, value);
        if (!host || host.mode !== "native" || !host.ready || !host.visible ||
            !hasUnplacedKeys(value, ["version", "instanceID", "state", "anchor"])) return;
        try {
            // 同一窗口最多一个菜单，新菜单不会改变任何地图的相机或原生可见性。
            dismissUnplaced(host.win, "replace");
            const sessionID = unplacedFor(host).open(event, {state: value.state, anchor: value.anchor});
            return sessionID ? {version: 1, instanceID: host.init.instanceID, sessionID} : undefined;
        } catch (_error) { host.unplaced?.dismiss("operation-failed"); }
    });
    for (const [name, method, field] of [["update", "update", "state"], ["anchor", "setAnchor", "anchor"],
        ["theme", "setTheme", "theme"], ["close", "close", "reason"]]) {
        ipcMain.on("siyuan-map-unplaced-" + name, (event, value) => {
            const host = getHost(event, value);
            if (!host || !hasUnplacedKeys(value, ["version", "instanceID", "sessionID", field])) return;
            try { host.unplaced?.[method](event, {sessionID: value.sessionID, [field]: value[field]}); }
            catch (_error) { host.unplaced?.dismiss("operation-failed"); }
        });
    }
    ipcMain.on(UNPLACED_CHANNEL + "-action", (event, value) => {
        for (const host of hosts.values()) {
            if (host.unplaced?.inspect()?.view.webContents !== event.sender) continue;
            try { host.unplaced.action(event, value); }
            catch (_error) { host.unplaced.dismiss("operation-failed"); }
            return;
        }
    });
    const currentWebviewOwner = host => host.mode === "webview" && !hasUnsafeMapSwitches(app.commandLine) &&
        getHost({sender: host.owner, senderFrame: host.frame}, host.init) === host;
    const closeMapGuest = contents => {
        try { contents.setWindowOpenHandler(() => ({action: "deny"})); } catch (_error) { /* 对象可能已被前序监听器销毁。 */ }
        try { if (!contents.isDestroyed()) contents.close({waitForBeforeUnload: false}); } catch (_error) { /* 会话路由仍保持拒绝。 */ }
    };
    const installAttachmentOwner = owner => {
        if (attachmentOwners.has(owner)) return;
        attachmentOwners.add(owner);
        const beforeAttach = (event, preferences, params) => {
            // 仅接管保留的地图分区，其余插件和文档 webview 保留原有行为。
            if (typeof params?.partition !== "string" || !params.partition.startsWith("siyuan-map-")) return;
            const host = [...hosts.values()].find(item => item.partition === params.partition);
            if (!host || host.owner !== owner || event.sender !== owner || !currentWebviewOwner(host) ||
                host.attachmentAccepted || !isMapWebviewAttachment(params, host)) {
                event.preventDefault();
                return;
            }
            try {
                const zoomFactor = owner.getZoomFactor();
                if (!Number.isFinite(zoomFactor) || zoomFactor < 0.25 || zoomFactor > 5) {
                    event.preventDefault();
                    fail(host, "hostAttachFailed");
                    return;
                }
                hardenMapWebviewPreferences(preferences, host.session, host.partition);
                // 清空不可信偏好后恢复主窗口缩放，避免初次挂载回落到 100%。
                preferences.zoomFactor = zoomFactor;
                host.attachmentAccepted = true;
            } catch (_error) {
                event.preventDefault();
                fail(host, "hostAttachFailed");
            }
        };
        const didAttach = (_event, contents) => {
            let host, mapGuest = false;
            try {
                if (contents.isDestroyed() || !webviewSessions.has(contents.session)) return;
                mapGuest = true;
                host = [...hosts.values()].find(item => item.contents === contents);
                if (!host || !currentWebviewOwner(host) || host.attachmentVerified || contents.hostWebContents !== owner ||
                    contents.session !== host.session || getMapWebviewPreferenceMismatch(contents.getLastWebPreferences())) {
                    if (host) fail(host, "hostAttachFailed");
                    closeMapGuest(contents);
                    return;
                }
                host.attachmentVerified = true;
            } catch (_error) {
                if (host) fail(host, "hostAttachFailed");
                if (mapGuest) closeMapGuest(contents);
            }
        };
        owner.on("will-attach-webview", beforeAttach);
        owner.on("did-attach-webview", didAttach);
        owner.once("destroyed", () => {
            owner.removeListener("will-attach-webview", beforeAttach);
            owner.removeListener("did-attach-webview", didAttach);
        });
    };
    app.on("web-contents-created", (_event, contents) => {
        let host, mapGuest = false, ownsReservation = false;
        try {
            if (contents.isDestroyed() || contents.getType() !== "webview" || !webviewSessions.has(contents.session)) return;
            mapGuest = true;
            host = [...hosts.values()].find(item => item.session === contents.session);
            ownsReservation = !!host && !host.contents && contents.hostWebContents === host.owner && host.attachmentAccepted;
            // main.js 的通用外链处理器先安装；地图 guest 必须在首次加载前覆盖为拒绝。
            contents.setWindowOpenHandler(() => ({action: "deny"}));
            if (!ownsReservation || !currentWebviewOwner(host) || getMapWebviewPreferenceMismatch(contents.getLastWebPreferences())) {
                closeMapGuest(contents);
                if (ownsReservation) fail(host, "hostAttachFailed");
                return;
            }
            host.attachContents(contents);
        } catch (_error) {
            if (ownsReservation) fail(host, "hostAttachFailed");
            if (mapGuest) closeMapGuest(contents);
        }
    });
    ipcMain.handle("siyuan-map-capability", event => {
        const result = inspectOwner(event);
        const reason = result.reason || (hasUnsafeMapSwitches(app.commandLine) ? "unsafeProcessSwitches" : undefined);
        return reason ? {version: 1, supported: false, reason} : {version: 1, supported: true};
    });
    ipcMain.handle("siyuan-map-create", (event, value) => {
        const owner = trustedOwner(event);
        const init = parseMapCreate(value);
        if (!owner || !init) throw new Error("Invalid map host owner or configuration");
        if (hasUnsafeMapSwitches(app.commandLine)) return {version: 1, instanceID: init.instanceID, error: "unsupportedEnvironment"};
        const key = event.sender.id + ":" + init.instanceID;
        if (hosts.has(key) || hosts.size >= 32 || [...hosts.values()].filter(host => host.owner === event.sender).length >= 8) {
            return {version: 1, instanceID: init.instanceID, error: "hostLimitReached"};
        }
        let host, router, view, ses;
        let creationFailure = "hostSetupFailed";
        const report = (code, resource) => {
            if (!host || host.destroyed || !mapDiagnosticCodes.includes(code) ||
                resource !== undefined && (!mapCSPDiagnosticCodes.includes(code) || !isMapCSPResource(resource))) return;
            // 按实例去重并限制总量，同一指令拒绝不同受限来源时也保留证据。
            const key = code + ":" + (resource || "");
            if (host.diagnostics.has(key) || host.diagnostics.size >= MAX_MAP_DIAGNOSTICS) return;
            host.diagnostics.add(key);
            sendOwner(host, {version: 1, instanceID: init.instanceID, type: "diagnostic", code,
                ...(resource === undefined ? {} : {resource})});
        };
        try {
            const partition = "siyuan-map-" + randomID();
            ses = session.fromPartition(partition, {cache: false});
            router = createMapSessionRouter({ses, origin: owner.origin, appDir, readFile, trackFetch, report});
            if (owner.mode === "native") view = new WebContentsView({webPreferences: {session: ses, sandbox: true, contextIsolation: true,
                webSecurity: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
                nodeIntegrationInWorker: false, webviewTag: false, allowRunningInsecureContent: false,
                navigateOnDragDrop: false, safeDialogs: true, disableDialogs: true, devTools: false,
                spellcheck: false, backgroundThrottling: false, preload: path.join(__dirname, "mapHostPreload.js")}});
            const nonce = randomID();
            const entryURL = owner.origin + "/stage/map/index.html?provider=openfreemap#" + init.instanceID + ":" + nonce;
            host = {key, init, owner: event.sender, frame: event.senderFrame, win: owner.win, origin: owner.origin, diagnostics: new Set(), report,
                mode: owner.mode, session: ses, partition, entryURL, view, router, listeners: [], ids: new Set(), revision: -1,
                loaded: false, ready: false, bootstrapped: false, destroyed: false,
                visible: false, attributionGestureUntil: 0};
            hosts.set(key, host);
            listen(host, event.sender, "destroyed", () => destroy(host));
            listen(host, event.sender, "render-process-gone", () => destroy(host));
            listen(host, owner.win, "closed", () => destroy(host));
            listen(host, event.sender, "did-start-navigation", details => {
                if (details.isMainFrame && !details.isSameDocument) destroy(host);
            });
            for (const name of ["hide", "minimize"]) listen(host, owner.win, name, () => hide(host));
            if (host.mode === "native") {
                for (const name of ["resize", "enter-full-screen", "leave-full-screen"]) {
                    listen(host, owner.win, name, () => hide(host));
                }
                listen(host, event.sender, "zoom-changed", () => hide(host));
            }
            // 失焦仅撤销署名外链手势，DOM 自行处理本地地图的裁剪和叠层。
            listen(host, owner.win, "blur", () => { host.attributionGestureUntil = 0; });
            for (const name of ["focus", "show", "restore"]) listen(host, owner.win, name, () => applyGeometry(host));
            host.attachContents = contents => {
                host.contents = contents;
                // 全局 web-contents-created 会安装外部打开链接处理器，必须在加载前替换为拒绝。
                contents.setWindowOpenHandler(() => ({action: "deny"}));
                const armAttributionClick = () => {
                    if (host.ready && host.visible && host.win.isFocused() && host.win.isVisible() && !host.win.isMinimized()) {
                        host.attributionGestureUntil = Date.now() + 1000;
                    }
                };
                listen(host, contents, "before-mouse-event", (_event, input) => {
                    if (input.type === "mouseDown") {
                        if (host.mode === "native") dismissUnplaced(host.win, "outside");
                        else if (currentWebviewOwner(host) && host.ready && host.visible && host.win.isFocused() &&
                            host.win.isVisible() && !host.win.isMinimized()) {
                            sendOwner(host, {version: 1, instanceID: host.init.instanceID, type: "dismissMenu"});
                        }
                    }
                    if (input.type === "mouseUp" && input.button === "left") armAttributionClick();
                });
                listen(host, contents, "before-input-event", (_event, input) => {
                    if (input.type === "keyDown" && input.key === "Enter" && !input.isAutoRepeat) armAttributionClick();
                });
                mapContents.add(contents.id);
                const denyNavigation = event => event.preventDefault();
                for (const name of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
                    listen(host, contents, name, denyNavigation);
                }
                listen(host, contents, "select-client-certificate", (event, _url, _certificates, callback) => { event.preventDefault(); callback(); });
                listen(host, contents, "login", (event, _details, _auth, callback) => { event.preventDefault(); callback(); });
                listen(host, contents, "certificate-error", (_event, _url, _error, _certificate, callback) => callback(false));
                listen(host, contents, "console-message", (event, _level, legacyMessage) => {
                    const message = event?.message ?? legacyMessage;
                    const resources = classifyMapCSPResources(message, host.origin);
                    for (const code of classifyMapConsoleMessage(message)) {
                        if (!resources.some(item => item.code === code)) report(code);
                    }
                    for (const {code, resource} of resources) report(code, resource);
                });
                listen(host, contents, "did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
                    if (isMainFrame === false) return;
                    report("documentLoadFailed");
                    fail(host, "hostDocumentLoadFailed");
                });
                listen(host, contents, "render-process-gone", () => fail(host, "hostRendererGone"));
                if (host.mode === "webview") {
                    listen(host, contents, "did-navigate-in-page", () => fail(host, "hostDocumentMismatch"));
                    listen(host, contents, "did-navigate", (_event, url) => {
                        if (url !== entryURL) fail(host, "hostDocumentMismatch");
                    });
                }
                listen(host, contents, "destroyed", () => fail(host, "hostDestroyed"));
                listen(host, contents, "did-finish-load", () => {
                    if (host.destroyed) return;
                    try {
                        if (host.mode === "webview" && !host.attachmentVerified) { fail(host, "hostAttachFailed"); return; }
                        if (host.loaded) { fail(host, "hostDocumentReloaded"); return; }
                        if (contents.getURL() !== entryURL) { fail(host, "hostDocumentMismatch"); return; }
                        host.loaded = true;
                        // 初始隐藏的 renderer 必须显式唤醒产帧，否则 SDK 的 load 会等待显示，而显示又等待 ready。
                        contents.setBackgroundThrottling(false);
                        applyGeometry(host);
                        const {port1, port2} = new MessageChannelMain();
                        host.port = port1;
                        host.transferredPort = port2;
                        port1.on("message", ({data}) => {
                            if (host.destroyed) return;
                            if (getHost({sender: host.owner, senderFrame: host.frame}, host.init) !== host) {
                                destroy(host);
                                return;
                            }
                            const reply = parseMapReply(data, init.instanceID);
                            if (!reply) return;
                            try {
                                if (reply.type === "bootstrapReady" && !host.bootstrapped) {
                                    host.bootstrapped = true;
                                    // 打包资源和 CSP 已准备完成，此后只等待地图创建与 load 就绪。
                                    setDeadline(host, MAP_HOST_READY_TIMEOUT);
                                    post(host, init);
                                } else if (reply.type === "ready" && host.bootstrapped && !host.ready) {
                                    host.ready = true;
                                    clearTimeout(host.timer);
                                    if (host.points) post(host, host.points);
                                    post(host, {version: 1, instanceID: init.instanceID, type: "theme", theme: init.theme});
                                    if (host.destroyed) return;
                                    applyGeometry(host);
                                    if (host.destroyed) return;
                                    contents.setBackgroundThrottling(true);
                                    sendOwner(host, reply);
                                } else if (reply.type === "markerClick" && host.ready && reply.revision === host.revision && host.ids.has(reply.id)) {
                                    sendOwner(host, reply);
                                } else if (reply.type === "attributionClick" && host.ready && host.visible &&
                                    host.win.isFocused() && host.win.isVisible() && !host.win.isMinimized() &&
                                    host.attributionGestureUntil > Date.now()) {
                                    host.attributionGestureUntil = 0;
                                    sendOwner(host, reply);
                                } else if (reply.type === "error") {
                                    fail(host, reply.code === "hostUnavailable" ?
                                        host.bootstrapped ? "hostOperationFailed" : "hostBootstrapFailed" : reply.code);
                                }
                            } catch (_error) { fail(host, "hostOperationFailed"); }
                        });
                        port1.on("close", () => fail(host, "hostPortClosed"));
                        port1.start();
                        contents.postMessage("siyuan-map-port", {version: 1, instanceID: init.instanceID, nonce, provider: init.provider}, [port2]);
                    } catch (_error) { fail(host, "hostPortSetupFailed"); }
                });
            };
            setDeadline(host, MAP_HOST_BOOTSTRAP_TIMEOUT);
            if (host.mode === "webview") {
                webviewSessions.add(ses);
                installAttachmentOwner(event.sender);
                return {version: 1, instanceID: init.instanceID, mode: "webview", src: entryURL, partition};
            }
            host.attachContents(view.webContents);
            creationFailure = "hostAttachFailed";
            view.setVisible(false);
            // DOM 暂时不可见时也能完成初始化；此占位视图始终隐藏，不会覆盖编辑器。
            view.setBounds({x: 0, y: 0, width: 1, height: 1});
            owner.win.contentView.addChildView(view);
            // Electron 添加的新地图会位于最上层；只提升菜单，不重排或隐藏其他地图。
            for (const other of hosts.values()) if (other.win === owner.win) other.unplaced?.promote();
            void host.contents.loadURL(entryURL).catch(() => { report("documentLoadFailed"); fail(host, "hostDocumentLoadFailed"); });
        } catch (_error) {
            if (host) fail(host, creationFailure);
            else if (router) router.destroy();
            else if (ses) clearMapSession(ses);
            return {version: 1, instanceID: init.instanceID, error: creationFailure};
        }
        return {version: 1, instanceID: init.instanceID, mode: "native"};
    });
    ipcMain.on("siyuan-map-command", (event, value) => {
        const host = getHost(event, value);
        if (!host) return;
        const command = parseMapCommand(value, host.init.instanceID);
        if (!command) return;
        if (command.type === "visibility") {
            if (host.mode !== "webview") return;
            host.visibility = command.visible ? {visible: true, ...(command.viewport && {viewport: command.viewport})} : {visible: false};
            applyGeometry(host);
            return;
        }
        if (command.type === "destroy") { destroy(host); return; }
        if (command.type === "setPoints") {
            if (command.revision <= host.revision) return;
            host.revision = command.revision;
            host.points = command;
            host.ids = new Set(command.points.map(point => point.id));
        } else if (command.type === "theme") host.init.theme = command.theme;
        if (host.ready) post(host, command);
    });
    ipcMain.on("siyuan-map-geometry", (event, value) => {
        const host = getHost(event, value);
        if (!host || host.mode !== "native") return;
        try {
            const geometry = parseMapGeometry(value, host.owner.getZoomFactor(), host.win.getContentBounds(), host.report);
            if (!geometry?.visible) { hide(host); return; }
            host.geometry = geometry;
            applyGeometry(host);
        } catch (_error) { fail(host, "hostOperationFailed"); }
    });
    ipcMain.on("siyuan-map-destroy", (event, value) => destroy(getHost(event, value)));
    app.on("before-quit", () => [...hosts.values()].forEach(destroy));
    return {destroyAll: () => [...hosts.values()].forEach(destroy)};
};

module.exports = {createMapSessionRouter, createMapHostManager, MAP_HOST_BOOTSTRAP_TIMEOUT, MAP_HOST_READY_TIMEOUT};
