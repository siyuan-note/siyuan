// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

const path = require("node:path");
const fs = require("node:fs/promises");
const {randomBytes} = require("node:crypto");
const {hardenMapWebviewPreferences, isMapWebviewAttachment, getMapWebviewPreferenceMismatch} = require("./mapWebviewHost");
const {mapDiagnosticCodes, mapCSPDiagnosticCodes, isMapCSPResource, MAX_MAP_DIAGNOSTICS, classifyMapConsoleMessage,
    classifyMapCSPResources} = require("./mapHostDiagnostics");
const {
    hasUnsafeMapSwitches, normalizeMapOrigin, parseMapCreate, parseMapCommand, parseMapReply,
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

const createMapHostManager = ({app, ipcMain, session, BrowserWindow, MessageChannelMain,
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
        return {owner: {win, origin, mode: "webview", kernelMode: target.mode}};
    };
    const trustedOwner = event => inspectOwner(event).owner;
    const getHost = (event, value) => {
        if (!event?.sender || value?.version !== 1 || typeof value.instanceID !== "string") return;
        const host = hosts.get(event.sender.id + ":" + value.instanceID);
        if (!host || host.destroyed || host.owner !== event.sender || host.frame !== event.senderFrame) return;
        const owner = trustedOwner(event);
        if (owner && host.win === owner.win && host.origin === owner.origin &&
            host.mode === owner.mode && host.kernelMode === owner.kernelMode) return host;
        // 切换内核目标后，即使两者都使用 webview，也不能复用原来的隔离会话和端口。
        destroy(host);
    };
    const sendOwner = (host, reply) => {
        if (!host.destroyed && !host.owner.isDestroyed()) {
            try { host.owner.send("siyuan-map-reply", reply); } catch (_error) { destroy(host); }
        }
    };
    const setVisible = (host, visible) => {
        host.visible = visible && host.ready && host.win.isVisible() && !host.win.isMinimized();
        if (!host.visible) host.attributionGestureUntil = 0;
        const visibility = host.visible ? host.visibility : {visible: false};
        const key = JSON.stringify(visibility);
        if (host.ready && key !== host.lastVisibility) {
            host.lastVisibility = key;
            post(host, {version: 1, instanceID: host.init.instanceID, type: "visibility", ...visibility});
        }
    };
    const hide = host => setVisible(host, false);
    const destroy = host => {
        if (!host || host.destroyed) return;
        host.destroyed = true;
        clearTimeout(host.timer);
        hosts.delete(host.key);
        for (const [emitter, name, listener] of host.listeners) emitter.removeListener(name, listener);
        host.ids.clear();
        host.points = undefined;
        host.router.destroy();
        for (const port of [host.port, host.transferredPort]) {
            try { port?.close(); } catch (_error) { /* 端口已转移或关闭。 */ }
        }
        // 移除 DOM 不保证销毁 WebContents，必须实际关闭 SDK 渲染器。
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
    const applyVisibility = host => setVisible(host, host.visibility?.visible === true);
    const currentWebviewOwner = host => host.mode === "webview" && !hasUnsafeMapSwitches(app.commandLine) &&
        getHost({sender: host.owner, senderFrame: host.frame}, host.init) === host;
    const closeMapGuest = contents => {
        try { contents.setWindowOpenHandler(() => ({action: "deny"})); } catch (_error) { /* 对象可能已被前序监听器销毁。 */ }
        try { if (!contents.isDestroyed()) contents.close({waitForBeforeUnload: false}); } catch (_error) { /* 会话路由仍保持拒绝。 */ }
    };
    // 由主进程在加载窗口文档前调用，远程窗口自首次执行页面脚本起默认拒绝 webview。
    const registerOwner = owner => {
        if (attachmentOwners.has(owner)) return;
        attachmentOwners.add(owner);
        const beforeAttach = (event, preferences, params) => {
            // 本地普通 webview 保留既有行为；远程或未登记目标只能使用主进程保留的地图分区。
            if (typeof params?.partition !== "string" || !params.partition.startsWith("siyuan-map-")) {
                if (getTarget(owner.id)?.mode !== "local") event.preventDefault();
                return;
            }
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
                if (contents.isDestroyed()) return;
                if (!webviewSessions.has(contents.session)) {
                    if (getTarget(owner.id)?.mode !== "local") closeMapGuest(contents);
                    return;
                }
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
            if (contents.isDestroyed() || contents.getType() !== "webview") return;
            if (!webviewSessions.has(contents.session)) {
                const owner = contents.hostWebContents;
                if (owner && attachmentOwners.has(owner) && getTarget(owner.id)?.mode !== "local") closeMapGuest(contents);
                return;
            }
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
        getHost(event, init);
        if (hosts.has(key) || hosts.size >= 32 || [...hosts.values()].filter(host => host.owner === event.sender).length >= 8) {
            return {version: 1, instanceID: init.instanceID, error: "hostLimitReached"};
        }
        let host, router, ses;
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
            const nonce = randomID();
            const entryURL = owner.origin + "/stage/map/index.html?provider=openfreemap#" + init.instanceID + ":" + nonce;
            host = {key, init, owner: event.sender, frame: event.senderFrame, win: owner.win, origin: owner.origin, diagnostics: new Set(), report,
                mode: owner.mode, kernelMode: owner.kernelMode, session: ses, partition, entryURL, router, listeners: [], ids: new Set(), revision: -1,
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
            // 失焦仅撤销署名外链手势，DOM 处理地图的裁剪和叠层。
            listen(host, owner.win, "blur", () => { host.attributionGestureUntil = 0; });
            for (const name of ["focus", "show", "restore"]) listen(host, owner.win, name, () => applyVisibility(host));
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
                        if (currentWebviewOwner(host) && host.ready && host.visible && host.win.isFocused() &&
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
                listen(host, contents, "did-navigate-in-page", () => fail(host, "hostDocumentMismatch"));
                listen(host, contents, "did-navigate", (_event, url) => {
                    if (url !== entryURL) fail(host, "hostDocumentMismatch");
                });
                listen(host, contents, "destroyed", () => fail(host, "hostDestroyed"));
                listen(host, contents, "did-finish-load", () => {
                    if (host.destroyed) return;
                    try {
                        if (!currentWebviewOwner(host)) { destroy(host); return; }
                        if (!host.attachmentVerified) { fail(host, "hostAttachFailed"); return; }
                        if (host.loaded) { fail(host, "hostDocumentReloaded"); return; }
                        if (contents.getURL() !== entryURL) { fail(host, "hostDocumentMismatch"); return; }
                        host.loaded = true;
                        // 初始隐藏的 renderer 必须显式唤醒产帧，否则 SDK 的 load 会等待显示，而显示又等待 ready。
                        contents.setBackgroundThrottling(false);
                        applyVisibility(host);
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
                                    applyVisibility(host);
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
            webviewSessions.add(ses);
            registerOwner(event.sender);
            return {version: 1, instanceID: init.instanceID, mode: "webview", src: entryURL, partition};
        } catch (_error) {
            if (host) fail(host, "hostSetupFailed");
            else if (router) router.destroy();
            else if (ses) clearMapSession(ses);
            return {version: 1, instanceID: init.instanceID, error: "hostSetupFailed"};
        }
    });
    ipcMain.on("siyuan-map-command", (event, value) => {
        const host = getHost(event, value);
        if (!host) return;
        const command = parseMapCommand(value, host.init.instanceID);
        if (!command) return;
        if (command.type === "visibility") {
            host.visibility = command.visible ? {visible: true, ...(command.viewport && {viewport: command.viewport})} : {visible: false};
            applyVisibility(host);
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
    ipcMain.on("siyuan-map-destroy", (event, value) => destroy(getHost(event, value)));
    app.on("before-quit", () => [...hosts.values()].forEach(destroy));
    return {registerOwner, destroyAll: () => [...hosts.values()].forEach(destroy)};
};

module.exports = {createMapSessionRouter, createMapHostManager, MAP_HOST_BOOTSTRAP_TIMEOUT, MAP_HOST_READY_TIMEOUT};
