const {randomUUID} = require("node:crypto");
const {parsePageURL, requestPage} = require("./webPageNetwork");

// 在隔离世界中读取活的 DOM，避免页面覆盖提取逻辑所需的 JavaScript 内建方法。
const extractPageDOM = () => {
    const selectors = ["main", "article", "[role=main]", ".main-content", "#main-content", ".article-body", ".post-content", ".entry-content", ".content", "body"];
    let selected;
    let text = "";
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        const candidate = element?.innerText?.trim() || "";
        if (candidate.length > text.length) {
            selected = element;
            text = candidate;
        }
        if (candidate.length >= 100) {
            selected = element;
            text = candidate;
            break;
        }
    }
    if (!selected || !text) {
        return {html: "", text: ""};
    }
    const clone = selected.cloneNode(true);
    for (const element of clone.querySelectorAll("script, style, noscript, template, iframe, object, embed, nav, [hidden], [aria-hidden=true]")) {
        element.remove();
    }
    for (const element of clone.querySelectorAll("[href], [src]")) {
        for (const name of ["href", "src"]) {
            const value = element.getAttribute(name);
            if (value) {
                try {
                    const url = new URL(value, document.baseURI);
                    if (["http:", "https:"].includes(url.protocol)) {
                        element.setAttribute(name, url.href);
                    } else {
                        element.removeAttribute(name);
                    }
                } catch {
                    element.removeAttribute(name);
                }
            }
        }
    }
    const html = clone.outerHTML;
    if (html.length > 5 * 1024 * 1024) {
        throw new Error("Page DOM too large");
    }
    return {html, text};
};

const createWebPageFetcher = ({BrowserWindow, session, lookup, timeoutMs = 30000, idleMs = 500,
    postLoadMs = 5000, extractionMs = 2000}) => {
    let active = 0;
    return async (rawURL, resolveProxy, caller, requestTimeoutMs = timeoutMs) => {
        const url = parsePageURL(rawURL);
        if (active >= 3) {
            throw new Error("Too many concurrent rendered page fetches; retry after a current fetch finishes");
        }
        const controller = new AbortController();
        const fetchSession = session.fromPartition("siyuan-web-fetch-" + randomUUID(), {cache: false});
        active++;
        let window;
        let idleTimer;
        let postLoadTimer;
        let totalTimer;
        let extractionTimer;
        let setupTimer;
        let finished = false;
        let extracting = false;
        let loaded = false;
        let plain = false;
        let mainDocumentURL = url.href.split("#")[0];
        let mainDocumentPending = true;
        let requestCount = 0;
        const requests = new Set();
        let fail;
        let scheduleIdle;
        const onCallerDestroyed = () => fail?.(new Error("Calling window closed"));
        try {
            fetchSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
            fetchSession.setPermissionCheckHandler(() => false);
            fetchSession.setDevicePermissionHandler(() => false);
            // HTTP 协议处理器在实际拨号时固定公网 IP，重定向、子资源和页面脚本请求均走同一路径。
            for (const scheme of ["http", "https"]) {
                fetchSession.protocol.handle(scheme, async request => {
                    const mainDocument = mainDocumentPending && request.url === mainDocumentURL;
                    if (mainDocument) {
                        mainDocumentPending = false;
                    }
                    const token = Symbol();
                    requests.add(token);
                    clearTimeout(idleTimer);
                    try {
                        if (++requestCount > 1024 || requests.size > 128) {
                            throw new Error("Page made too many network requests");
                        }
                        const headers = new Headers(request.headers);
                        headers.set("DNT", "1");
                        headers.set("Sec-GPC", "1");
                        if (mainDocument) {
                            headers.set("Accept", "text/markdown, text/html;q=0.9, application/xhtml+xml;q=0.9, */*;q=0.7");
                        }
                        const response = await requestPage(new Request(request, {headers}),
                            {resolveProxy, signal: controller.signal, lookup});
                        if (/^attachment(?:;|$)/i.test(response.headers.get("content-disposition") || "")) {
                            throw new Error("Page downloads are not allowed");
                        }
                        if (mainDocument) {
                            if (response.status >= 400) {
                                throw new Error(`HTTP ${response.status}`);
                            }
                            plain = /^text\/(markdown|plain)(?:;|$)/i.test(response.headers.get("content-type") || "");
                            if (/^text\/markdown(?:;|$)/i.test(response.headers.get("content-type") || "")) {
                                response.headers.set("content-type", "text/plain; charset=utf-8");
                            }
                        }
                        // 另加独立 CSP，不削弱站点自己的策略；正文抓取不启动工作线程或嵌入页面。
                        response.headers.append("Content-Security-Policy", "worker-src 'none'; frame-src 'none'; object-src 'none'");
                        return response;
                    } catch (error) {
                        // 子资源仍受相同的地址和资源限制，失败时仅丢弃该资源，保留已加载的正文。
                        if (mainDocument) {
                            fail?.(error);
                        }
                        return Response.error();
                    } finally {
                        requests.delete(token);
                        scheduleIdle?.();
                    }
                });
            }
            window = new BrowserWindow({show: false, width: 1024, height: 768, webPreferences: {
                session: fetchSession, javascript: true, offscreen: true, images: false, sandbox: true,
                nodeIntegration: false, contextIsolation: true, webviewTag: false, webgl: false,
                backgroundThrottling: false, disableDialogs: true, navigateOnDragDrop: false,
            }});
            const contents = window.webContents;
            contents.setUserAgent(contents.getUserAgent().replace(/\s*SiYuan\/\S+/gi, "").replace(/\s*Electron\/\S+/gi, ""));
            contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
            contents.setWindowOpenHandler(() => ({action: "deny"}));
            contents.on("will-attach-webview", event => event.preventDefault());
            contents.on("select-client-certificate", event => event.preventDefault());
            // 禁用不经过 HTTP 协议处理器的页面联网入口，脚本在每个框架创建时、站点脚本之前执行。
            await Promise.race([
                (async () => {
                    await window.loadURL("about:blank");
                    contents.debugger.attach("1.3");
                    await contents.debugger.sendCommand("Page.enable");
                    await contents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {source: `
                        for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "WebTransport", "WebSocket"]) {
                            Object.defineProperty(globalThis, name, {value: undefined, writable: false, configurable: false});
                        }
                    `});
                })(),
                new Promise((_resolve, reject) => {
                    setupTimer = setTimeout(() => reject(new Error("Page renderer setup timed out")), extractionMs);
                }),
            ]);
            clearTimeout(setupTimer);
            if (caller?.isDestroyed()) {
                throw new Error("Calling window closed");
            }
            caller?.once("destroyed", onCallerDestroyed);
            return await new Promise((resolve, reject) => {
                const finish = (error, result) => {
                    if (finished) {
                        return;
                    }
                    finished = true;
                    if (error) {
                        reject(error);
                    } else {
                        resolve(result);
                    }
                };
                fail = error => finish(error);
                const extract = async (finalAttempt = false) => {
                    if (finished || extracting) {
                        return;
                    }
                    extracting = true;
                    extractionTimer = setTimeout(() => fail(new Error("Page content extraction timed out")), extractionMs);
                    try {
                        const code = plain ? "({html: '', text: document.body?.textContent || ''})" : `(${extractPageDOM.toString()})()`;
                        const result = await contents.executeJavaScriptInIsolatedWorld(999, [{code}]);
                        if (!result?.text?.trim() || (!finalAttempt && result.text.trim().length < 100)) {
                            extracting = false;
                            clearTimeout(extractionTimer);
                            // 空壳页面继续等待异步正文，直到加载后的等待期限结束。
                            return false;
                        }
                        finish(null, {...result, plain});
                        return true;
                    } catch (error) {
                        fail(error);
                    }
                };
                const idle = () => {
                    clearTimeout(idleTimer);
                    if (loaded && requests.size === 0) {
                        idleTimer = setTimeout(() => void extract(), idleMs);
                    }
                };
                scheduleIdle = idle;
                const markLoaded = () => {
                    if (loaded) {
                        return;
                    }
                    loaded = true;
                    idle();
                    postLoadTimer = setTimeout(async () => {
                        const found = await extract(true);
                        if (found === false) {
                            fail(new Error("No meaningful content found after waiting for JavaScript rendering"));
                        }
                    }, postLoadMs);
                };
                fetchSession.webRequest.onBeforeRequest((details, callback) => {
                    try {
                        parsePageURL(details.url);
                        if (details.resourceType === "mainFrame") {
                            mainDocumentURL = details.url;
                            mainDocumentPending = true;
                        }
                        callback({cancel: finished});
                    } catch (error) {
                        callback({cancel: true});
                        if (details.resourceType === "mainFrame") {
                            fail(error);
                        }
                    }
                });
                fetchSession.on("will-download", event => {
                    event.preventDefault();
                    fail(new Error("Page downloads are not allowed"));
                });
                const checkNavigation = event => {
                    try {
                        parsePageURL(event.url);
                    } catch (error) {
                        event.preventDefault();
                        if (event.isMainFrame) {
                            fail(error);
                        }
                    }
                };
                contents.on("will-navigate", checkNavigation);
                contents.on("will-redirect", checkNavigation);
                contents.on("will-frame-navigate", checkNavigation);
                contents.on("did-finish-load", markLoaded);
                contents.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
                    if (!mainFrame) {
                        return;
                    }
                    if (code === -3 || code === -27) {
                        markLoaded();
                    } else {
                        fail(new Error(`Page load failed: ${description}`));
                    }
                });
                contents.once("render-process-gone", () => fail(new Error("Page renderer exited")));
                totalTimer = setTimeout(() => fail(new Error("Page fetch timed out")), requestTimeoutMs);
                window.loadURL(url.href).catch(error => {
                    if (error.code !== "ERR_ABORTED" && error.code !== "ERR_BLOCKED_BY_CLIENT") {
                        fail(error);
                    }
                });
            });
        } finally {
            finished = true;
            controller.abort();
            for (const timer of [idleTimer, postLoadTimer, totalTimer, extractionTimer, setupTimer]) {
                clearTimeout(timer);
            }
            caller?.removeListener("destroyed", onCallerDestroyed);
            if (window && !window.isDestroyed()) {
                window.destroy();
            }
            for (const scheme of ["http", "https"]) {
                fetchSession.protocol.unhandle(scheme);
            }
            try {
                await fetchSession.closeAllConnections();
                await fetchSession.clearStorageData();
            } finally {
                active--;
            }
        }
    };
};

const installWebPageFetchIPC = (ipcMain, fetchPage, isTrustedSender) => {
    ipcMain.handle("siyuan-web-page-fetch", async (event, data) => {
        if (!isTrustedSender(event.sender) || event.senderFrame !== event.sender.mainFrame ||
            typeof data?.url !== "string" || data.url.length > 8192) {
            throw new Error("Rendered page fetch is unavailable");
        }
        const timeoutMs = Number.isFinite(data.timeout) && data.timeout >= 1 ?
            Math.min(Math.floor(data.timeout), 600) * 1000 : undefined;
        return fetchPage(data.url, url => event.sender.session.resolveProxy(url), event.sender, timeoutMs);
    });
};

module.exports = {createWebPageFetcher, installWebPageFetchIPC};
