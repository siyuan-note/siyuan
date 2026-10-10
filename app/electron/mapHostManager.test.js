const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {test} = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {createMapSessionRouter, createMapHostManager} = require("./mapHostManager");

const origin = "http://127.0.0.1:6806";
const instanceID = "a".repeat(48);
const envelope = {version: 1, instanceID};
const createSession = () => {
    const ses = Object.assign(new EventEmitter(), {handlers: {}, protocols: {}, cleanup: [], fetches: []});
    for (const method of ["setPermissionRequestHandler", "setPermissionCheckHandler", "setDevicePermissionHandler",
        "setDisplayMediaRequestHandler", "setCertificateVerifyProc", "allowNTLMCredentialsForDomains"]) {
        ses[method] = value => { ses.handlers[method] = value; };
    }
    for (const method of ["closeAllConnections", "clearStorageData", "clearAuthCache", "clearCache", "clearHostResolverCache"]) {
        ses[method] = async () => { ses.cleanup.push(method); };
    }
    ses.webRequest = {};
    for (const method of ["onBeforeRequest", "onBeforeSendHeaders", "onHeadersReceived"]) {
        ses.webRequest[method] = handler => { ses.handlers[method] = handler; };
    }
    ses.protocol = {handle(scheme, handler) { ses.protocols[scheme] = handler; }};
    ses.fetch = async (url, options) => {
        ses.fetches.push({url, options});
        return new Response("tile", {headers: {"Content-Type": "application/octet-stream"}});
    };
    ses.before = details => {
        let result;
        ses.handlers.onBeforeRequest({method: "GET", resourceType: "xhr", ...details}, value => { result = value; });
        return result;
    };
    return ses;
};
const setupRouter = (options = {}) => {
    const ses = createSession();
    const files = [];
    const router = createMapSessionRouter({ses, origin, provider: "openfreemap", appDir: "/app", readFile: async file => {
        files.push(file); return Buffer.from("asset");
    }, ...options});
    return {ses, router, files};
};

test("anonymous map session blocks permissions, downloads, credentials and all non-manifest kernel traffic", async () => {
    const {ses, router, files} = setupRouter();
    let permission;
    ses.handlers.setPermissionRequestHandler({}, "geolocation", result => { permission = result; });
    assert.equal(permission, false);
    assert.equal(ses.handlers.setPermissionCheckHandler(), false);
    assert.equal(ses.handlers.setDevicePermissionHandler(), false);
    let download = false;
    ses.emit("will-download", {preventDefault() { download = true; }});
    assert.equal(download, true);
    for (const url of [origin + "/api/system/getConf", origin + "/api/network/proxy", "http://127.0.0.1:6807/api/sql",
        "file:///etc/passwd", "ws://127.0.0.1:6806/ws", "https://webapi.amap.com/maps"]) {
        assert.equal(ses.before({url}).cancel, true, url);
        assert.equal((await ses.protocols.http(new Request(url.replace(/^ws:/, "http:")))).status, 403);
    }
    const response = await ses.protocols.http(new Request(origin + "/stage/map/index.html?provider=openfreemap"));
    assert.equal(await response.text(), "asset");
    assert.equal(files.length, 1);
    assert.equal(files[0], "/app/stage/map/index.html");
    assert.match(response.headers.get("content-security-policy"), /sandbox allow-scripts/);
    assert.equal(ses.fetches.length, 0);
    let headers;
    ses.handlers.onBeforeSendHeaders({requestHeaders: {Cookie: "secret", Authorization: "secret", "Proxy-Authorization": "secret", Accept: "*/*"}}, value => { headers = value; });
    assert.deepEqual(headers.requestHeaders, {Accept: "*/*"});
    ses.handlers.onHeadersReceived({responseHeaders: {"Set-Cookie": ["secret"], "Content-Type": ["image/png"]}}, value => { headers = value; });
    assert.deepEqual(headers.responseHeaders, {"Content-Type": ["image/png"]});
    router.destroy();
});

test("session allows only one exact initial document and no subframe, websocket or service worker", async () => {
    const {ses, router} = setupRouter();
    const url = origin + "/stage/map/index.html?provider=openfreemap";
    assert.equal(ses.before({url, resourceType: "mainFrame"}).cancel, false);
    assert.equal(ses.before({url, resourceType: "mainFrame"}).cancel, true);
    for (const resourceType of ["subFrame", "webSocket"]) {
        assert.equal(ses.before({url: "https://tiles.openfreemap.org/a", resourceType}).cancel, true);
    }
    assert.equal(ses.before({url: "blob:" + origin + "/worker", resourceType: "other"}).cancel, false);
    assert.equal(ses.before({url: "data:text/html,evil", resourceType: "mainFrame"}).cancel, true);
    assert.equal((await ses.protocols.http(new Request(origin + "/stage/build/map/host.js", {headers: {"Service-Worker": "script"}}))).status, 403);
    router.destroy();
});

test("provider forwarding uses its own session with no browser secrets and validates every redirect", async () => {
    const {ses, router} = setupRouter();
    ses.fetch = async (url, options) => {
        ses.fetches.push({url, options});
        return new Response(null, {status: 302, headers: {Location: origin + "/api/system/getConf"}});
    };
    const request = new Request("https://tiles.openfreemap.org/start", {headers: {
        Cookie: "secret", Authorization: "Bearer secret", "X-User-Token": "secret", Referer: origin + "/private-note", Accept: "application/json",
    }});
    assert.equal((await ses.protocols.https(request)).status, 403);
    assert.equal(ses.fetches.length, 1);
    assert.equal(ses.fetches[0].options.credentials, "omit");
    assert.equal(ses.fetches[0].options.bypassCustomProtocolHandlers, true);
    assert.equal(ses.fetches[0].options.redirect, "manual");
    assert.deepEqual(ses.fetches[0].options.headers, {Referer: origin + "/", accept: "application/json"});
    router.destroy();
});

test("same-provider redirects work without leaking redirect headers or provider cookies", async () => {
    const tracked = [];
    const {ses, router} = setupRouter({trackFetch: (url, delta) => tracked.push([url, delta])});
    ses.fetch = async (url, options) => {
        ses.fetches.push({url, options});
        return url.endsWith("/start") ? new Response(null, {status: 307, headers: {Location: "/end"}}) :
            new Response("tile", {headers: {"Set-Cookie": "secret", Refresh: "0;url=http://localhost", "Content-Type": "image/png"}});
    };
    const response = await ses.protocols.https(new Request("https://tiles.openfreemap.org/start"));
    assert.equal(await response.text(), "tile");
    assert.equal(ses.fetches.length, 2);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("refresh"), null);
    assert.equal(tracked.reduce((total, entry) => total + entry[1], 0), 0);
    router.destroy();
});

test("destroy aborts in-flight provider requests, clears session state and leaves orphan traffic denied", async () => {
    const {ses, router} = setupRouter();
    let signal;
    ses.fetch = async (_url, options) => {
        signal = options.signal;
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    };
    const pending = ses.protocols.https(new Request("https://tiles.openfreemap.org/tile"));
    router.destroy();
    assert.equal(signal.aborted, true);
    assert.equal((await pending).status, 403);
    assert.equal(ses.before({url: "https://tiles.openfreemap.org/tile"}).cancel, true);
    assert.equal((await ses.protocols.http(new Request(origin + "/stage/map/host.css"))).status, 403);
    assert.deepEqual(ses.cleanup.sort(), ["clearAuthCache", "clearCache", "clearHostResolverCache", "clearStorageData", "closeAllConnections"].sort());
    router.destroy();
    assert.equal(ses.cleanup.length, 5);
});

const setup = (initialFault) => {
    let sequence = 0;
    const faults = new Set(initialFault ? [initialFault] : []);
    const fault = name => {
        if (faults.has(name)) throw new Error("https://private.invalid/?key=secret " + name);
    };
    const handlers = {}, sessions = [], views = [], channels = [], order = [], switches = new Map();
    const app = Object.assign(new EventEmitter(), {commandLine: {
        hasSwitch: name => switches.has(name), getSwitchValue: name => switches.get(name),
    }});
    const contents = id => Object.assign(new EventEmitter(), {id, mainFrame: {url: origin + "/stage/build/app/"}, sent: [], destroyed: false, zoom: 1,
        isDestroyed() { return this.destroyed; }, getZoomFactor() { return this.zoom; },
        send(...args) { this.sent.push(structuredClone(args)); }});
    const owner = contents(1);
    const win = Object.assign(new EventEmitter(), {webContents: owner, destroyed: false, focused: true, children: [],
        isDestroyed() { return this.destroyed; }, isFocused() { return this.focused; },
        isVisible: () => true, isMinimized: () => false, getContentBounds: () => ({width: 1000, height: 800})});
    win.contentView = {addChildView: view => { fault("attach"); win.children.push(view); },
        removeChildView: view => { fault("detach"); win.children = win.children.filter(item => item !== view); }};
    const target = {origin};
    let initialized = true;
    const manager = createMapHostManager({app, appDir: "/app", getTarget: id => id === 1 ? target : undefined,
        isInitialized: () => initialized, readFile: async () => Buffer.from("asset"), randomID: () => (++sequence).toString(16).padStart(48, "0"),
        ipcMain: {handle: (name, handler) => { handlers[name] = handler; }, on: (name, handler) => { handlers[name] = handler; }},
        BrowserWindow: {fromWebContents: value => value === owner ? win : undefined},
        session: {fromPartition(partition, options) {
            fault("session");
            const ses = createSession(); Object.assign(ses, {partition, options}); sessions.push(ses);
            const setPermission = ses.setPermissionRequestHandler;
            ses.setPermissionRequestHandler = value => { fault("router"); setPermission(value); };
            return ses;
        }},
        WebContentsView: class {
            constructor(options) {
                fault("view");
                this.options = options;
                this.webContents = contents(100 + views.length);
                Object.assign(this.webContents, {
                    setWindowOpenHandler(handler) { fault("openHandler"); this.openHandler = handler; order.push("openHandler"); },
                    getURL() { return this.url; },
                    loadURL(url) {
                        fault("loadSync"); this.url = url; order.push("load");
                        if (faults.has("earlyConsole")) {
                            this.emit("console-message", {message: "Creating a worker from 'blob:null/private' violates the following Content Security Policy directive: \"worker-src 'none'\"."});
                        }
                        return faults.has("loadAsync") ? Promise.reject(new Error("private load failure")) : Promise.resolve();
                    },
                    postMessage(...args) { fault("portTransfer"); this.transferred = args; },
                    setZoomFactor(zoom) { this.zoom = zoom; },
                    setBackgroundThrottling(value) { this.throttling = value; order.push("throttling:" + value); },
                    stop() { fault("stop"); this.stopped = true; },
                    close(options) { this.closeOptions = options; this.destroyed = true; this.emit("destroyed"); },
                });
                const on = this.webContents.on;
                this.webContents.on = function (...args) { fault("listener"); return on.apply(this, args); };
                views.push(this);
            }
            setVisible(value) { this.visible = value; }
            setBounds(value) { fault("bounds"); this.bounds = value; }
        },
        MessageChannelMain: class {
            constructor() {
                fault("channel");
                const port = () => Object.assign(new EventEmitter(), {sent: [],
                    on(...args) { fault("portListener"); return EventEmitter.prototype.on.apply(this, args); },
                    postMessage(value) { fault("portPost"); this.sent.push(structuredClone(value)); },
                    start() { fault("portStart"); this.started = true; }, close() { this.closed = true; }});
                this.port1 = port(); this.port2 = port(); channels.push(this);
            }
        },
    });
    const event = () => ({sender: owner, senderFrame: owner.mainFrame});
    const create = (data = {}) => handlers["siyuan-map-create"](event(), {...envelope, provider: "openfreemap", theme: "light", ...data});
    const command = data => handlers["siyuan-map-command"](event(), {...envelope, ...data});
    const reply = data => channels.at(-1).port1.emit("message", {data: {...envelope, ...data}});
    const load = () => views.at(-1).webContents.emit("did-finish-load");
    return {manager, app, handlers, sessions, views, channels, order, switches, owner, win, target, event, create, command, reply, load, faults,
        setInitialized(value) { initialized = value; }};
};

test("WCV has a unique memory session, secure preferences, no external-open handler and no credentials before bootstrap", () => {
    const s = setup();
    assert.deepEqual(s.create({provider: "amap", credentials: {apiKey: "test-key", securityCode: "test-code"}}), envelope);
    const prefs = s.views[0].options.webPreferences;
    assert.equal(prefs.sandbox, true); assert.equal(prefs.webSecurity, true); assert.equal(prefs.contextIsolation, true);
    for (const key of ["nodeIntegration", "nodeIntegrationInSubFrames", "nodeIntegrationInWorker", "webviewTag", "allowRunningInsecureContent"]) {
        assert.equal(prefs[key], false);
    }
    assert.equal(s.sessions[0].partition.startsWith("persist:"), false);
    assert.deepEqual(s.sessions[0].options, {cache: false});
    assert.deepEqual(s.order, ["openHandler", "load"]);
    assert.deepEqual(s.views[0].webContents.openHandler({url: "file:///etc/passwd"}), {action: "deny"});
    assert.equal(s.views[0].visible, false);
    assert.equal(s.views[0].webContents.url.includes("test-key"), false);
    s.load();
    assert.equal(s.channels[0].port1.sent.length, 0);
    s.reply({type: "ready"});
    assert.equal(s.owner.sent.length, 0);
    s.reply({type: "bootstrapReady"});
    assert.equal(s.channels[0].port1.sent[0].credentials.apiKey, "test-key");
    s.reply({type: "bootstrapReady"});
    assert.equal(s.channels[0].port1.sent.length, 1);
    s.manager.destroyAll();
});

test("only initialized registered owner main frame may create, update or destroy a map", () => {
    const s = setup();
    const create = s.handlers["siyuan-map-create"];
    const config = {...envelope, provider: "openfreemap", theme: "light"};
    assert.throws(() => create({...s.event(), senderFrame: {}}, config));
    s.setInitialized(false); assert.throws(() => create(s.event(), config)); s.setInitialized(true);
    s.owner.mainFrame.url = "http://evil.example/stage/build/app/"; assert.throws(() => create(s.event(), config));
    s.owner.mainFrame.url = origin + "/stage/build/app/";
    s.create();
    s.handlers["siyuan-map-destroy"]({...s.event(), senderFrame: {}}, envelope);
    assert.equal(s.views[0].webContents.destroyed, false);
    s.target.origin = "http://127.0.0.1:6807";
    s.handlers["siyuan-map-destroy"](s.event(), envelope);
    assert.equal(s.views[0].webContents.destroyed, false);
    s.manager.destroyAll();
});

test("points and clicks are bounded by current revision and membership; ready is one-shot", () => {
    const s = setup(); s.create(); s.load();
    s.command({type: "setPoints", revision: 2, points: [{id: "row", longitude: 10, latitude: 20, coordinateSystem: "wgs84", secret: "never"}]});
    s.reply({type: "bootstrapReady"}); s.reply({type: "ready"}); s.reply({type: "ready"});
    assert.equal(s.owner.sent.filter(entry => entry[1].type === "ready").length, 1);
    assert.equal(s.channels[0].port1.sent.find(entry => entry.type === "setPoints").points[0].secret, undefined);
    s.reply({type: "markerClick", id: "row", revision: 1});
    s.reply({type: "markerClick", id: "unknown", revision: 2});
    s.reply({type: "markerClick", id: "row", revision: 2, url: "https://evil.example"});
    assert.deepEqual(s.owner.sent.filter(entry => entry[1].type === "markerClick").map(entry => entry[1]),
        [{...envelope, type: "markerClick", id: "row", revision: 2}]);
    s.command({type: "setPoints", revision: 3, points: []});
    s.reply({type: "markerClick", id: "row", revision: 2});
    assert.equal(s.owner.sent.filter(entry => entry[1].type === "markerClick").length, 1);
    s.manager.destroyAll();
});

test("geometry is invisible before ready, uses owner zoom, and hides on invalid geometry or window transitions", () => {
    const s = setup(); s.create(); s.load(); s.owner.zoom = 1.25;
    const geometry = {...envelope, visible: true, bounds: {x: 10, y: 20, width: 200, height: 100},
        logicalSize: {width: 400, height: 300}, crop: {x: 30, y: 40}};
    s.handlers["siyuan-map-geometry"](s.event(), geometry);
    assert.equal(s.views[0].visible, false);
    assert.deepEqual(s.views[0].bounds, {x: 13, y: 25, width: 249, height: 125});
    s.reply({type: "bootstrapReady"}); s.reply({type: "ready"});
    assert.equal(s.views[0].visible, true);
    assert.deepEqual(s.views[0].bounds, {x: 13, y: 25, width: 249, height: 125});
    assert.equal(s.views[0].webContents.zoom, 1.25);
    s.win.emit("resize"); assert.equal(s.views[0].visible, false);
    s.handlers["siyuan-map-geometry"](s.event(), geometry); assert.equal(s.views[0].visible, true);
    s.handlers["siyuan-map-geometry"](s.event(), {...geometry, bounds: {...geometry.bounds, width: 10000}});
    assert.equal(s.views[0].visible, false);
    assert.deepEqual(s.owner.sent.at(-1)[1], {...envelope, type: "diagnostic", code: "geometryLogicalBounds"});
    const count = s.owner.sent.length;
    s.handlers["siyuan-map-geometry"](s.event(), {...geometry, bounds: {...geometry.bounds, width: 10000}});
    assert.equal(s.owner.sent.length, count);
    s.manager.destroyAll();
});

test("hidden bootstrap receives nonzero bounds and rendering frames without becoming visible", () => {
    const s = setup(); s.create();
    const view = s.views[0];
    assert.equal(view.options.webPreferences.backgroundThrottling, false);
    assert.deepEqual(view.bounds, {x: 0, y: 0, width: 1, height: 1});
    assert.equal(view.visible, false);
    const geometry = {...envelope, visible: true, bounds: {x: 10, y: 20, width: 200, height: 100},
        logicalSize: {width: 400, height: 300}, crop: {x: 30, y: 40}};
    s.handlers["siyuan-map-geometry"](s.event(), geometry);
    assert.deepEqual(view.bounds, geometry.bounds);
    assert.equal(view.webContents.sent.length, 0, "viewport waits for the preload to exist");
    s.load();
    assert.equal(view.webContents.throttling, false);
    assert.equal(view.visible, false);
    assert.deepEqual(view.webContents.sent[0], ["siyuan-map-viewport", {logicalSize: geometry.logicalSize, crop: geometry.crop}]);
    s.reply({type: "bootstrapReady"});
    s.handlers["siyuan-map-geometry"](s.event(), {...envelope, visible: false});
    s.reply({type: "ready"});
    assert.equal(view.visible, false, "a menu or hidden DOM during bootstrap must still hide the native view");
    assert.equal(view.webContents.throttling, true, "normal throttling resumes after bootstrap");
    s.handlers["siyuan-map-geometry"](s.event(), geometry);
    assert.equal(view.visible, true);
    s.manager.destroyAll();
    assert.equal(view.webContents.destroyed, true);
});

test("an initially hidden or zero-size DOM can finish bootstrap without exposing the placeholder", () => {
    const s = setup(); s.create(); s.load();
    s.handlers["siyuan-map-geometry"](s.event(), {...envelope, visible: true, bounds: {x: 0, y: 0, width: 0, height: 0},
        logicalSize: {width: 0, height: 0}, crop: {x: 0, y: 0}});
    assert.deepEqual(s.views[0].bounds, {x: 0, y: 0, width: 1, height: 1});
    assert.equal(s.views[0].webContents.throttling, false);
    s.reply({type: "bootstrapReady"}); s.reply({type: "ready"});
    assert.equal(s.views[0].visible, false);
    assert.equal(s.views[0].webContents.throttling, true);
    s.manager.destroyAll();
    s.load();
    assert.equal(s.views[0].visible, false);
    assert.equal(s.views[0].webContents.destroyed, true);
});

test("known host diagnostics are bounded fixed codes and stop on disposal", () => {
    const s = setup(); s.create();
    const contents = s.views[0].webContents;
    const message = "Content Security Policy worker-src 'none'; https://secret.invalid/?key=private";
    contents.emit("console-message", {message});
    contents.emit("console-message", {message});
    contents.emit("console-message", {message: "unclassified private detail"});
    assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "diagnostic", code: "cspWorker"}]);
    s.manager.destroyAll();
    contents.emit("console-message", {message: "INVALID_USER_KEY"});
    assert.equal(s.owner.sent.length, 1);
});

test("CSP resources are captured before load, deduplicated by category and isolated from the map port", () => {
    const s = setup("earlyConsole"); s.create();
    assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "diagnostic", code: "cspWorker", resource: "blob"}]);
    const contents = s.views[0].webContents;
    const emit = url => contents.emit("console-message", {}, 2,
        `Connecting to '${url}' violates the following Content Security Policy directive: "connect-src https://webapi.amap.com".`);
    emit("https://g.alicdn.com/path?key=secret");
    emit("https://g.alicdn.com/another?key=another-secret");
    emit("blob:null/private");
    for (let index = 0; index < 100; index++) emit(`https://unknown-${index}.invalid/secret`);
    assert.deepEqual(s.owner.sent.map(entry => entry[1].resource), ["blob", "https:g.alicdn.com", "blob", "redacted"]);
    assert.equal(JSON.stringify(s.owner.sent).includes("secret"), false);
    const count = s.owner.sent.length;
    s.load();
    s.reply({type: "diagnostic", code: "cspWorker", resource: "https:g.alicdn.com"});
    s.owner.emit("console-message", {message: "Content Security Policy worker-src 'none'"});
    assert.equal(s.owner.sent.length, count, "only the known map contents can contribute diagnostics");
    s.manager.destroyAll();
    emit("https://fourier.taobao.com/private");
    assert.equal(s.owner.sent.length, count);
});

test("dynamic public CSP source diagnostics remain bounded per host", () => {
    const s = setup(); s.create();
    const contents = s.views[0].webContents;
    for (let index = 0; index < 100; index++) {
        contents.emit("console-message", {message: `Connecting to 'https://map${index}.amap.com/private?key=secret' violates the following Content Security Policy directive: "connect-src https://webapi.amap.com".`});
    }
    assert.equal(s.owner.sent.length, 64);
    assert.ok(s.owner.sent.every(entry => entry[1].instanceID === envelope.instanceID));
    assert.equal(JSON.stringify(s.owner.sent).includes("secret"), false);
    s.manager.destroyAll();
});

test("provider routing reports fixed transport failures without logging requests", async () => {
    const diagnostics = [];
    const {ses, router} = setupRouter({report: code => diagnostics.push(code)});
    ses.before({url: "http://webapi.amap.com/maps?key=private"});
    assert.deepEqual(diagnostics, ["providerInsecureRequest"]);
    ses.fetch = async () => new Response("private body", {status: 403});
    assert.equal((await ses.protocols.https(new Request("https://tiles.openfreemap.org/style?key=private"))).status, 403);
    assert.equal(diagnostics.at(-1), "providerHTTPFailure");
    ses.fetch = async () => { throw new Error("https://secret.invalid/?key=private"); };
    await ses.protocols.https(new Request("https://tiles.openfreemap.org/style?key=private"));
    assert.equal(diagnostics.at(-1), "providerNetworkFailure");
    ses.fetch = async () => new Response(null, {status: 302, headers: {Location: "http://tiles.openfreemap.org/?key=private"}});
    await ses.protocols.https(new Request("https://tiles.openfreemap.org/style"));
    assert.equal(diagnostics.at(-1), "providerInsecureRequest");
    ses.fetch = async () => new Response(new ReadableStream({pull(controller) { controller.error(new Error("private body failure")); }}));
    const broken = await ses.protocols.https(new Request("https://tiles.openfreemap.org/style"));
    await assert.rejects(broken.text());
    assert.equal(diagnostics.at(-1), "providerNetworkFailure");
    const count = diagnostics.length;
    router.destroy();
    ses.before({url: "http://webapi.amap.com/maps?key=private"});
    assert.equal(diagnostics.length, count);
    assert.equal(JSON.stringify(diagnostics).includes("private"), false);
});

test("destroy and owner navigation close real contents, ports, requests and session; stale events cannot resurrect", () => {
    const s = setup(); s.create(); s.load(); s.reply({type: "bootstrapReady"});
    s.owner.emit("did-start-navigation", {isMainFrame: true, isSameDocument: false});
    assert.equal(s.views[0].webContents.destroyed, true);
    assert.deepEqual(s.views[0].webContents.closeOptions, {waitForBeforeUnload: false});
    assert.equal(s.channels[0].port1.closed, true); assert.equal(s.channels[0].port2.closed, true);
    assert.equal(s.win.children.length, 0); assert.equal(s.sessions[0].cleanup.length, 5);
    s.reply({type: "ready"}); assert.equal(s.owner.sent.length, 0);
    s.manager.destroyAll(); assert.equal(s.sessions[0].cleanup.length, 5);
    s.create({instanceID: "b".repeat(48)});
    assert.notEqual(s.sessions[0].partition, s.sessions[1].partition);
    s.manager.destroyAll();
});

test("unsafe effective switches reject creation and duplicate instance IDs cannot replace a running host", () => {
    const s = setup(); s.switches.set("disable-web-security", "");
    assert.equal(s.create().error, "unsupportedEnvironment"); assert.equal(s.views.length, 0);
    s.switches.clear(); s.create(); assert.equal(s.create().error, "hostLimitReached"); assert.equal(s.views.length, 1);
    s.manager.destroyAll();
});

test("capability is credential-free and only supports trusted owners with safe process switches", () => {
    const s = setup();
    const capability = s.handlers["siyuan-map-capability"];
    assert.deepEqual(capability(s.event()), {version: 1, supported: true});
    assert.deepEqual(capability({...s.event(), senderFrame: {}}), {version: 1, supported: false, reason: "notMainFrame"});
    s.switches.set("no-sandbox", "");
    assert.deepEqual(capability(s.event()), {version: 1, supported: false, reason: "unsafeProcessSwitches"});
    assert.equal(s.views.length, 0);
});

test("Electron's default file-access switch permits the HTTP map host while file access stays denied", async () => {
    const s = setup();
    s.switches.set("allow-file-access-from-files", "");
    assert.deepEqual(s.handlers["siyuan-map-capability"](s.event()), {version: 1, supported: true});
    assert.deepEqual(s.create(), envelope);
    const ses = s.sessions[0];
    assert.equal((await ses.protocols.file(new Request("file:///etc/passwd"))).status, 403);
    assert.equal(ses.before({url: "file:///etc/passwd", resourceType: "mainFrame"}).cancel, true);
    assert.equal(ses.before({url: "file:///etc/passwd", resourceType: "xhr"}).cancel, true);
    s.owner.mainFrame.url = "file:///app/index.html";
    assert.equal(s.handlers["siyuan-map-capability"](s.event()).supported, false);
    s.manager.destroyAll();
});

test("geometry updates cannot show a map in an unfocused window and focus restores fresh geometry", () => {
    const s = setup(); s.create(); s.load(); s.reply({type: "bootstrapReady"}); s.reply({type: "ready"});
    s.win.focused = false; s.win.emit("blur");
    s.handlers["siyuan-map-geometry"](s.event(), {...envelope, visible: true,
        bounds: {x: 10, y: 20, width: 200, height: 100}, logicalSize: {width: 200, height: 100}, crop: {x: 0, y: 0}});
    assert.equal(s.views[0].visible, false);
    s.win.focused = true; s.win.emit("focus");
    assert.equal(s.views[0].visible, true);
    s.win.focused = false; s.win.emit("blur");
    assert.equal(s.views[0].visible, false);
    s.win.focused = true; s.win.emit("focus");
    assert.equal(s.views[0].visible, true);
    s.manager.destroyAll();
});

test("navigation, redirects, client certificates, login and renderer failure are blocked", () => {
    const s = setup(); s.create(); const wc = s.views[0].webContents;
    for (const name of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
        let prevented = false; wc.emit(name, {preventDefault() { prevented = true; }}); assert.equal(prevented, true, name);
    }
    for (const name of ["select-client-certificate", "login"]) {
        let prevented = false, answered = false;
        wc.emit(name, {preventDefault() { prevented = true; }}, {}, {}, (...args) => { answered = true; assert.equal(args.length, 0); });
        assert.equal(prevented, true); assert.equal(answered, true);
    }
    wc.emit("render-process-gone"); assert.equal(wc.destroyed, true);
    assert.equal(s.owner.sent[0][1].code, "hostRendererGone");
});

test("main-process provider fetch cannot select client certificates or authenticate, including null WebContents", async () => {
    const s = setup(); s.create();
    let finish;
    s.sessions[0].fetch = () => new Promise(resolve => { finish = resolve; });
    const url = "https://tiles.openfreemap.org/tile";
    const pending = s.sessions[0].protocols.https(new Request(url));
    for (const name of ["select-client-certificate", "login"]) {
        let prevented = false, answered = false;
        s.app.emit(name, {preventDefault() { prevented = true; }}, null,
            name === "login" ? {url} : url, {}, (...args) => { answered = true; assert.equal(args.length, 0); });
        assert.equal(prevented, true); assert.equal(answered, true);
    }
    let affectedOtherURL = false;
    s.app.emit("select-client-certificate", {preventDefault() { affectedOtherURL = true; }}, null,
        "https://example.com/", [], () => {});
    assert.equal(affectedOtherURL, false);
    finish(new Response("tile"));
    assert.equal(await (await pending).text(), "tile");
    s.manager.destroyAll();
});

test("a closed runtime port destroys the map instead of retaining a live orphan renderer", () => {
    const s = setup(); s.create(); s.load();
    s.channels[0].port1.emit("close");
    assert.equal(s.views[0].webContents.destroyed, true);
    assert.equal(s.owner.sent[0][1].code, "hostPortClosed");
});

test("bootstrap and SDK receive separate deadlines and duplicate bootstrap cannot extend SDK lifetime", t => {
    t.mock.timers.enable({apis: ["setTimeout"]});
    const s = setup(); s.create(); s.load();
    t.mock.timers.tick(29000);
    s.reply({type: "bootstrapReady"});
    t.mock.timers.tick(39000);
    assert.equal(s.views[0].webContents.destroyed, false, "both SDK phases retain their own 20-second budget");
    assert.deepEqual(s.owner.sent, []);
    s.reply({type: "bootstrapReady"});
    t.mock.timers.tick(5999);
    assert.equal(s.views[0].webContents.destroyed, false);
    t.mock.timers.tick(1);
    assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "error", code: "hostSDKTimeout"}]);
    assert.equal(s.views[0].webContents.destroyed, true);
    assert.equal(s.channels[0].port1.closed, true);
});

test("document and bootstrap timeouts have distinct final codes and successful ready clears all deadlines", t => {
    t.mock.timers.enable({apis: ["setTimeout"]});
    for (const loaded of [false, true]) {
        const s = setup(); s.create();
        if (loaded) s.load();
        t.mock.timers.tick(29999);
        assert.deepEqual(s.owner.sent, []);
        t.mock.timers.tick(1);
        assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "error",
            code: loaded ? "hostBootstrapTimeout" : "hostDocumentLoadTimeout"}]);
        assert.equal(s.views[0].webContents.destroyed, true);
    }
    const s = setup(); s.create(); s.load();
    t.mock.timers.tick(29000); s.reply({type: "bootstrapReady"});
    t.mock.timers.tick(39999); s.reply({type: "ready"});
    t.mock.timers.tick(90000);
    assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "ready"}]);
    assert.equal(s.views[0].webContents.destroyed, false);
    s.manager.destroyAll();
});

test("creation failures return fixed stage codes and release every resource already allocated", () => {
    for (const [point, code] of [["session", "hostSetupFailed"], ["router", "hostSetupFailed"],
        ["view", "hostSetupFailed"], ["openHandler", "hostSetupFailed"], ["listener", "hostSetupFailed"],
        ["attach", "hostAttachFailed"], ["bounds", "hostAttachFailed"], ["loadSync", "hostAttachFailed"]]) {
        const s = setup(point);
        assert.deepEqual(s.create(), {...envelope, error: code}, point);
        assert.equal(s.win.children.length, 0, point);
        for (const ses of s.sessions) assert.equal(ses.cleanup.length, 5, point);
        for (const view of s.views) {
            assert.equal(view.webContents.destroyed, true, point);
            assert.equal(view.webContents.eventNames().length, 0, point);
        }
        assert.equal(JSON.stringify(s.owner.sent).includes("secret"), false, point);
        s.faults.clear();
        assert.deepEqual(s.create(), envelope, "a failed instance must not occupy its slot: " + point);
        s.manager.destroyAll();
    }
});

test("load rejection and main-frame failure report document failure without waiting for the deadline", async () => {
    const s = setup("loadAsync"); s.create();
    await Promise.resolve();
    assert.equal(s.owner.sent.at(-1)[1].code, "hostDocumentLoadFailed");
    assert.equal(s.views[0].webContents.destroyed, true);
    const f = setup(); f.create();
    f.views[0].webContents.emit("did-fail-load", {}, -2, "secret", "https://private.invalid/?key=secret", false);
    assert.deepEqual(f.owner.sent, []);
    f.views[0].webContents.emit("did-fail-load", {}, -2, "secret", "https://private.invalid/?key=secret", true);
    assert.equal(f.owner.sent.at(-1)[1].code, "hostDocumentLoadFailed");
    assert.equal(JSON.stringify(f.owner.sent).includes("secret"), false);
    assert.equal(f.views[0].webContents.destroyed, true);
});

test("unexpected document, reload, destruction and bootstrap rejection retain their final failure reason", () => {
    const cases = [
        ["hostDocumentMismatch", s => { s.views[0].webContents.url += "unexpected"; s.load(); }],
        ["hostDocumentReloaded", s => { s.load(); s.load(); }],
        ["hostDestroyed", s => { s.views[0].webContents.destroyed = true; s.views[0].webContents.emit("destroyed"); }],
        ["hostBootstrapFailed", s => { s.load(); s.reply({type: "error", code: "hostUnavailable"}); }],
        ["hostOperationFailed", s => { s.load(); s.reply({type: "bootstrapReady"}); s.reply({type: "error", code: "hostUnavailable"}); }],
    ];
    for (const [code, trigger] of cases) {
        const s = setup(); s.create(); trigger(s);
        assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "error", code}]);
        assert.equal(s.views[0].webContents.destroyed, true);
        assert.equal(s.win.children.length, 0);
        s.manager.destroyAll();
        assert.equal(s.owner.sent.length, 1, "disposal must not manufacture another hostDestroyed failure");
    }
});

test("port setup and message failures close both endpoints and preserve the fixed failure stage", () => {
    for (const point of ["channel", "portListener", "portStart", "portTransfer"]) {
        const s = setup(); s.create(); s.faults.add(point); s.load();
        assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "error", code: "hostPortSetupFailed"}], point);
        assert.equal(s.views[0].webContents.destroyed, true, point);
        for (const channel of s.channels) {
            assert.equal(channel.port1.closed, true, point);
            assert.equal(channel.port2.closed, true, point);
        }
    }
    for (const ready of [false, true]) {
        const s = setup(); s.create(); s.load();
        if (ready) s.reply({type: "bootstrapReady"});
        s.faults.add("portPost");
        s.reply({type: ready ? "ready" : "bootstrapReady"});
        assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "error", code: "hostOperationFailed"}]);
        assert.equal(s.views[0].webContents.destroyed, true);
        assert.equal(s.views[0].webContents.throttling, false, "a failed post must not continue ready operations");
    }
});

test("renderer closure still runs when detaching the view or stopping it throws", () => {
    const s = setup(); s.create(); s.load();
    s.faults.add("detach"); s.faults.add("stop");
    s.channels[0].port1.emit("close");
    assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "error", code: "hostPortClosed"}]);
    assert.equal(s.views[0].webContents.destroyed, true);
    assert.equal(s.sessions[0].cleanup.length, 5);
    assert.equal(s.channels[0].port1.closed, true);
    assert.equal(s.channels[0].port2.closed, true);
});

test("main wiring removes only the process security bypass and never enables remote on map contents", () => {
    const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
    assert.ok(!source.includes('appendSwitch("disable-web-security")'));
    assert.match(source, /createMapHostManager\(/);
    assert.match(source, /webSecurity: kernelTarget.mode === "remote"/);
    const manager = fs.readFileSync(path.join(__dirname, "mapHostManager.js"), "utf8");
    assert.ok(!manager.includes("remote.enable"));
    assert.ok(!manager.includes("executeJavaScript"));
    assert.ok(!manager.includes("session.defaultSession"));
});


test("capability reports bounded reasons for every owner rejection without weakening creation", () => {
    const cases = [
        ["ownerUnavailable", (_s, event) => { event.sender = undefined; }],
        ["ownerUnavailable", s => { s.owner.destroyed = true; }],
        ["notMainFrame", (_s, event) => { event.senderFrame = {url: "https://private.invalid/secret"}; }],
        ["notInitialized", s => s.setInitialized(false)],
        ["unregisteredOwner", s => { s.owner.id = 2; }],
        ["invalidKernelOrigin", s => { s.target.origin = "https://private.invalid/secret"; }],
        ["ownerUnavailable", (_s, event) => { event.sender = {...event.sender}; }],
        ["ownerUnavailable", s => { s.win.destroyed = true; }],
        ["originMismatch", s => { s.owner.mainFrame.url = "https://private.invalid/stage/build/app/?token=secret"; }],
        ["unsupportedDocument", s => { s.owner.mainFrame.url = origin + "/check-auth?token=secret"; }],
        ["invalidDocument", s => { s.owner.mainFrame.url = "invalid secret"; }],
    ];
    for (const [reason, change] of cases) {
        const s = setup(), event = s.event();
        change(s, event);
        assert.deepEqual(s.handlers["siyuan-map-capability"](event), {version: 1, supported: false, reason});
        assert.throws(() => s.handlers["siyuan-map-create"](event, {...envelope, provider: "openfreemap", theme: "light"}));
        assert.equal(s.views.length, 0);
        s.manager.destroyAll();
    }
});
