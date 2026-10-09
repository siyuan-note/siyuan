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

const setup = () => {
    let sequence = 0;
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
    win.contentView = {addChildView: view => win.children.push(view), removeChildView: view => { win.children = win.children.filter(item => item !== view); }};
    const target = {origin};
    let initialized = true;
    const manager = createMapHostManager({app, appDir: "/app", getTarget: id => id === 1 ? target : undefined,
        isInitialized: () => initialized, readFile: async () => Buffer.from("asset"), randomID: () => (++sequence).toString(16).padStart(48, "0"),
        ipcMain: {handle: (name, handler) => { handlers[name] = handler; }, on: (name, handler) => { handlers[name] = handler; }},
        BrowserWindow: {fromWebContents: value => value === owner ? win : undefined},
        session: {fromPartition(partition, options) { const ses = createSession(); Object.assign(ses, {partition, options}); sessions.push(ses); return ses; }},
        WebContentsView: class {
            constructor(options) {
                this.options = options;
                this.webContents = contents(100 + views.length);
                Object.assign(this.webContents, {
                    setWindowOpenHandler(handler) { this.openHandler = handler; order.push("openHandler"); },
                    getURL() { return this.url; },
                    async loadURL(url) { this.url = url; order.push("load"); },
                    postMessage(...args) { this.transferred = args; },
                    setZoomFactor(zoom) { this.zoom = zoom; },
                    stop() { this.stopped = true; },
                    close(options) { this.closeOptions = options; this.destroyed = true; this.emit("destroyed"); },
                });
                views.push(this);
            }
            setVisible(value) { this.visible = value; }
            setBounds(value) { this.bounds = value; }
        },
        MessageChannelMain: class {
            constructor() {
                const port = () => Object.assign(new EventEmitter(), {sent: [], postMessage(value) { this.sent.push(structuredClone(value)); },
                    start() { this.started = true; }, close() { this.closed = true; }});
                this.port1 = port(); this.port2 = port(); channels.push(this);
            }
        },
    });
    const event = () => ({sender: owner, senderFrame: owner.mainFrame});
    const create = (data = {}) => handlers["siyuan-map-create"](event(), {...envelope, provider: "openfreemap", theme: "light", ...data});
    const command = data => handlers["siyuan-map-command"](event(), {...envelope, ...data});
    const reply = data => channels.at(-1).port1.emit("message", {data: {...envelope, ...data}});
    const load = () => views.at(-1).webContents.emit("did-finish-load");
    return {manager, app, handlers, sessions, views, channels, order, switches, owner, win, target, event, create, command, reply, load,
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
    s.reply({type: "bootstrapReady"}); s.reply({type: "ready"});
    assert.equal(s.views[0].visible, true);
    assert.deepEqual(s.views[0].bounds, {x: 13, y: 25, width: 249, height: 125});
    assert.equal(s.views[0].webContents.zoom, 1.25);
    s.win.emit("resize"); assert.equal(s.views[0].visible, false);
    s.handlers["siyuan-map-geometry"](s.event(), geometry); assert.equal(s.views[0].visible, true);
    s.handlers["siyuan-map-geometry"](s.event(), {...geometry, bounds: {...geometry.bounds, width: 10000}});
    assert.equal(s.views[0].visible, false);
    s.manager.destroyAll();
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
    s.switches.clear(); s.create(); assert.equal(s.create().error, "hostUnavailable"); assert.equal(s.views.length, 1);
    s.manager.destroyAll();
});

test("capability is credential-free and only supports trusted owners with safe process switches", () => {
    const s = setup();
    const capability = s.handlers["siyuan-map-capability"];
    assert.deepEqual(capability(s.event()), {version: 1, supported: true});
    assert.deepEqual(capability({...s.event(), senderFrame: {}}), {version: 1, supported: false});
    s.switches.set("no-sandbox", "");
    assert.deepEqual(capability(s.event()), {version: 1, supported: false});
    assert.equal(s.views.length, 0);
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
    assert.equal(s.owner.sent[0][1].code, "hostUnavailable");
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
    assert.equal(s.owner.sent[0][1].code, "hostUnavailable");
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
