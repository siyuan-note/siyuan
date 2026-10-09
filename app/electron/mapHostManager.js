// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

const path = require("node:path");
const fs = require("node:fs/promises");
const {randomBytes} = require("node:crypto");
const {
    hasUnsafeMapSwitches, normalizeMapOrigin, parseMapCreate, parseMapCommand, parseMapReply, parseMapGeometry,
    isAllowedMapProviderURL, getMapRequestPolicy, createMapContentSecurityPolicy,
} = require("./mapHostPolicy");

const deniedResponse = () => new Response("Forbidden", {status: 403,
    headers: {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}});
const withoutCredentials = (headers) => Object.fromEntries(Object.entries(headers || {})
    .filter(([name]) => !["cookie", "authorization", "proxy-authorization"].includes(name.toLowerCase())));

// 此会话从不向任何内核发送网络请求，包括未设置密码的本机内核。
const createMapSessionRouter = ({ses, origin, provider, appDir, readFile = fs.readFile, trackFetch = () => {}}) => {
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
        const policy = getMapRequestPolicy(details.url, details.method, origin, provider);
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
        const policy = !destroyed && getMapRequestPolicy(request.url, request.method, origin, provider);
        if (!policy || request.headers.get("service-worker")) return deniedResponse();
        if (policy.type === "local") {
            try {
                const data = await readFile(path.join(appDir, policy.file[0]));
                if (destroyed) return deniedResponse();
                const headers = {"Content-Type": policy.file[1], "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*",
                    "Referrer-Policy": "strict-origin-when-cross-origin",
                    "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=(), usb=(), serial=(), bluetooth=()"};
                if (policy.document) headers["Content-Security-Policy"] = createMapContentSecurityPolicy(origin, provider);
                return new Response(request.method === "HEAD" ? null : data, {headers});
            } catch (_error) {
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
                if (destroyed || abort.signal.aborted || !isAllowedMapProviderURL(url, provider)) break;
                if (activeURL) trackFetch(activeURL, -1);
                activeURL = url;
                trackFetch(activeURL, 1);
                // 不复制浏览器凭证或任意请求头；服务商的密钥来源校验仅使用内核来源，不携带笔记路径。
                const headers = {"Referer": origin + "/"};
                for (const name of ["accept", "accept-language", "range"]) {
                    const value = request.headers.get(name);
                    if (value && value.length <= 4096) headers[name] = value;
                }
                const response = await ses.fetch(url, {method: request.method, headers, credentials: "omit",
                    cache: "no-store", redirect: "manual", bypassCustomProtocolHandlers: true, signal: abort.signal});
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
                        } catch (error) { controller.error(error); finish(); }
                    },
                    async cancel() { abort.abort(); await reader.cancel().catch(() => {}); finish(); },
                });
                return new Response(body, {status: response.status, headers: responseHeaders});
            }
        } catch (_error) {
            // 服务商地址可能包含密钥，不记录请求地址或异常文本。
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
            void Promise.allSettled([ses.closeAllConnections(), ses.clearStorageData(), ses.clearAuthCache(),
                ses.clearCache(), ses.clearHostResolverCache()]);
        },
    };
};

const createMapHostManager = ({app, ipcMain, session, BrowserWindow, WebContentsView, MessageChannelMain,
    getTarget, isInitialized, appDir, readFile, randomID = () => randomBytes(24).toString("hex")}) => {
    const hosts = new Map();
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
    const trustedOwner = event => {
        if (!event?.sender || event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame ||
            !isInitialized(event.sender.id)) return;
        const target = getTarget(event.sender.id);
        const origin = normalizeMapOrigin(target?.origin);
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!origin || !win || win.isDestroyed()) return;
        try {
            const url = new URL(event.senderFrame.url);
            if (url.origin !== origin || !["/stage/build/app/", "/stage/build/app/window.html"].includes(url.pathname)) return;
        } catch (_error) { return; }
        return {win, origin};
    };
    const getHost = (event, value) => {
        const owner = trustedOwner(event);
        if (!owner || value?.version !== 1 || typeof value.instanceID !== "string") return;
        const host = hosts.get(event.sender.id + ":" + value.instanceID);
        if (host && host.origin === owner.origin && host.frame === event.senderFrame) return host;
    };
    const sendOwner = (host, reply) => {
        if (!host.destroyed && !host.owner.isDestroyed()) host.owner.send("siyuan-map-reply", reply);
    };
    const hide = host => {
        host.geometry = undefined;
        if (!host.view.webContents.isDestroyed()) host.view.setVisible(false);
    };
    const destroy = host => {
        if (!host || host.destroyed) return;
        host.destroyed = true;
        clearTimeout(host.timer);
        hosts.delete(host.key);
        for (const [emitter, name, listener] of host.listeners) emitter.removeListener(name, listener);
        host.ids.clear();
        host.init.credentials = {};
        host.points = undefined;
        host.router.destroy();
        for (const port of [host.port, host.transferredPort]) {
            try { port?.close(); } catch (_error) { /* 端口已转移或关闭。 */ }
        }
        if (!host.win.isDestroyed()) host.win.contentView.removeChildView(host.view);
        // 移除视图不会销毁 WebContents，必须实际关闭 SDK 渲染器。
        if (!host.view.webContents.isDestroyed()) {
            host.view.webContents.stop();
            host.view.webContents.close({waitForBeforeUnload: false});
        }
        mapContents.delete(host.view.webContents.id);
    };
    const fail = (host, code) => {
        sendOwner(host, {version: 1, instanceID: host.init.instanceID, type: "error", code});
        destroy(host);
    };
    const listen = (host, emitter, name, listener) => {
        emitter.on(name, listener);
        host.listeners.push([emitter, name, listener]);
    };
    const post = (host, message) => {
        if (!host.destroyed && host.port) host.port.postMessage(message);
    };
    const applyGeometry = host => {
        const geometry = host.geometry;
        if (!geometry?.visible || !host.ready || host.destroyed) return;
        if (!host.win.isFocused() || !host.win.isVisible() || host.win.isMinimized()) {
            host.view.setVisible(false);
            return;
        }
        host.view.webContents.setZoomFactor(geometry.zoom);
        host.view.setBounds(geometry.bounds);
        host.view.webContents.send("siyuan-map-viewport", {logicalSize: geometry.logicalSize, crop: geometry.crop});
        host.view.setVisible(true);
        post(host, {version: 1, instanceID: host.init.instanceID, type: "resize"});
    };
    ipcMain.handle("siyuan-map-capability", event => ({version: 1,
        supported: !!trustedOwner(event) && !hasUnsafeMapSwitches(app.commandLine)}));
    ipcMain.handle("siyuan-map-create", (event, value) => {
        const owner = trustedOwner(event);
        const init = parseMapCreate(value);
        if (!owner || !init) throw new Error("Invalid map host owner or configuration");
        if (hasUnsafeMapSwitches(app.commandLine)) return {version: 1, instanceID: init.instanceID, error: "unsupportedEnvironment"};
        const key = event.sender.id + ":" + init.instanceID;
        if (hosts.has(key) || hosts.size >= 32 || [...hosts.values()].filter(host => host.owner === event.sender).length >= 8) {
            return {version: 1, instanceID: init.instanceID, error: "hostUnavailable"};
        }
        const ses = session.fromPartition("siyuan-map-" + randomID(), {cache: false});
        const router = createMapSessionRouter({ses, origin: owner.origin, provider: init.provider, appDir, readFile, trackFetch});
        let view;
        try {
            view = new WebContentsView({webPreferences: {session: ses, sandbox: true, contextIsolation: true,
                webSecurity: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
                nodeIntegrationInWorker: false, webviewTag: false, allowRunningInsecureContent: false,
                navigateOnDragDrop: false, safeDialogs: true, disableDialogs: true, devTools: false,
                spellcheck: false, preload: path.join(__dirname, "mapHostPreload.js")}});
        } catch (_error) {
            router.destroy();
            return {version: 1, instanceID: init.instanceID, error: "hostUnavailable"};
        }
        const contents = view.webContents;
        // 全局 web-contents-created 会安装外部打开链接处理器，必须在加载前替换为拒绝。
        contents.setWindowOpenHandler(() => ({action: "deny"}));
        mapContents.add(contents.id);
        const host = {key, init, owner: event.sender, frame: event.senderFrame, win: owner.win, origin: owner.origin,
            view, router, listeners: [], ids: new Set(), revision: -1, ready: false, bootstrapped: false, destroyed: false};
        hosts.set(key, host);
        const denyNavigation = event => event.preventDefault();
        for (const name of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
            listen(host, contents, name, denyNavigation);
        }
        listen(host, contents, "select-client-certificate", (event, _url, _certificates, callback) => { event.preventDefault(); callback(); });
        listen(host, contents, "login", (event, _details, _auth, callback) => { event.preventDefault(); callback(); });
        listen(host, contents, "certificate-error", (_event, _url, _error, _certificate, callback) => callback(false));
        listen(host, contents, "render-process-gone", () => fail(host, "hostUnavailable"));
        listen(host, contents, "destroyed", () => destroy(host));
        listen(host, event.sender, "destroyed", () => destroy(host));
        listen(host, event.sender, "render-process-gone", () => destroy(host));
        listen(host, event.sender, "did-start-navigation", details => {
            if (details.isMainFrame && !details.isSameDocument) destroy(host);
        });
        for (const name of ["resize", "hide", "minimize", "enter-full-screen", "leave-full-screen"]) {
            listen(host, owner.win, name, () => hide(host));
        }
        listen(host, owner.win, "blur", () => view.setVisible(false));
        for (const name of ["focus", "show", "restore"]) listen(host, owner.win, name, () => applyGeometry(host));
        listen(host, event.sender, "zoom-changed", () => hide(host));
        const nonce = randomID();
        const entryURL = owner.origin + "/stage/map/index.html?provider=" + init.provider + "#" + init.instanceID + ":" + nonce;
        let loaded = false;
        listen(host, contents, "did-finish-load", () => {
            if (host.destroyed) return;
            if (loaded || contents.getURL() !== entryURL) { fail(host, "hostUnavailable"); return; }
            loaded = true;
            const {port1, port2} = new MessageChannelMain();
            host.port = port1;
            host.transferredPort = port2;
            port1.on("message", ({data}) => {
                if (host.destroyed) return;
                const reply = parseMapReply(data, init.instanceID);
                if (!reply) return;
                if (reply.type === "bootstrapReady" && !host.bootstrapped) {
                    host.bootstrapped = true;
                    post(host, init);
                    init.credentials = {};
                } else if (reply.type === "ready" && host.bootstrapped && !host.ready) {
                    host.ready = true;
                    clearTimeout(host.timer);
                    if (host.points) post(host, host.points);
                    post(host, {version: 1, instanceID: init.instanceID, type: "theme", theme: init.theme});
                    if (host.pendingFit) post(host, {version: 1, instanceID: init.instanceID, type: "fit"});
                    applyGeometry(host);
                    sendOwner(host, reply);
                } else if (reply.type === "markerClick" && host.ready && reply.revision === host.revision && host.ids.has(reply.id)) {
                    sendOwner(host, reply);
                } else if (reply.type === "error") fail(host, reply.code);
            });
            port1.on("close", () => fail(host, "hostUnavailable"));
            port1.start();
            contents.postMessage("siyuan-map-port", {version: 1, instanceID: init.instanceID, nonce, provider: init.provider}, [port2]);
        });
        host.timer = setTimeout(() => fail(host, "hostUnavailable"), 30000);
        host.timer.unref?.();
        try {
            view.setVisible(false);
            owner.win.contentView.addChildView(view);
            void contents.loadURL(entryURL).catch(() => fail(host, "hostUnavailable"));
        } catch (_error) { fail(host, "hostUnavailable"); }
        return {version: 1, instanceID: init.instanceID};
    });
    ipcMain.on("siyuan-map-command", (event, value) => {
        const host = getHost(event, value);
        if (!host) return;
        const command = parseMapCommand(value, host.init.instanceID, host.init.provider);
        if (!command) return;
        if (command.type === "destroy") { destroy(host); return; }
        if (command.type === "setPoints") {
            if (command.revision <= host.revision) return;
            host.revision = command.revision;
            host.points = command;
            host.ids = new Set(command.points.map(point => point.id));
        } else if (command.type === "theme") host.init.theme = command.theme;
        else if (command.type === "fit") host.pendingFit = true;
        if (host.ready) post(host, command);
    });
    ipcMain.on("siyuan-map-geometry", (event, value) => {
        const host = getHost(event, value);
        if (!host) return;
        const geometry = parseMapGeometry(value, host.owner.getZoomFactor(), host.win.getContentBounds());
        if (!geometry?.visible) { hide(host); return; }
        host.geometry = geometry;
        applyGeometry(host);
    });
    ipcMain.on("siyuan-map-destroy", (event, value) => destroy(getHost(event, value)));
    app.on("before-quit", () => [...hosts.values()].forEach(destroy));
    return {destroyAll: () => [...hosts.values()].forEach(destroy)};
};

module.exports = {createMapSessionRouter, createMapHostManager};
