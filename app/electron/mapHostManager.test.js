const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {test} = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {createMapSessionRouter, createMapHostManager} = require("./mapHostManager");
const {MAP_WEBVIEW_PREFERENCES} = require("./mapWebviewHost");

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
    const router = createMapSessionRouter({ses, origin, appDir: "/app", readFile: async file => {
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

test("OpenFreeMap redirects cannot reach other providers or unapproved hosts on any hop", async () => {
    for (const to of ["jsapi.amap.com", "jsapi-service.amap.com", "webapi.amap.com", "restapi.amap.com",
        "webrd01.is.autonavi.com", "map.qq.com", "api.map.baidu.com", "tiles.openfreemap.org.evil.invalid"]) {
        const reports = [], tracked = [];
        const {ses, router} = setupRouter({report: code => reports.push(code),
            trackFetch: (url, delta) => tracked.push([url, delta])});
        ses.fetch = async (url, options) => {
            ses.fetches.push({url, options});
            return new Response(null, {status: 302, headers: {
                Location: url.endsWith("/start") ? "/next" : "https://" + to + "/private?key=secret",
            }});
        };
        const initialURL = "https://tiles.openfreemap.org/start";
        const response = await ses.protocols.https(new Request(initialURL));
        assert.equal(response.status, 403, to);
        assert.deepEqual(ses.fetches.map(fetch => fetch.url), [initialURL, "https://tiles.openfreemap.org/next"]);
        assert.deepEqual(reports, ["providerRequestDenied"]);
        assert.equal(response.headers.get("location"), null);
        assert.equal(tracked.reduce((total, entry) => total + entry[1], 0), 0);
        router.destroy();
    }
});

test("OpenFreeMap redirect loops remain bounded and release anonymous request tracking", async () => {
    const tracked = [];
    const {ses, router} = setupRouter({trackFetch: (url, delta) => tracked.push([url, delta])});
    ses.fetch = async (url, options) => {
        ses.fetches.push({url, options});
        return new Response(null, {status: 302, headers: {Location: "/loop"}});
    };
    assert.equal((await ses.protocols.https(new Request("https://tiles.openfreemap.org/loop"))).status, 403);
    assert.equal(ses.fetches.length, 6);
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

const setup = (initialFault, mode = "remote", autoAttach = true) => {
    let sequence = 0;
    const faults = new Set(initialFault ? [initialFault] : []);
    const fault = name => {
        if (faults.has(name)) throw new Error("https://private.invalid/?key=secret " + name);
    };
    const handlers = {}, sessions = [], guests = [], channels = [], order = [], switches = new Map();
    const app = Object.assign(new EventEmitter(), {commandLine: {
        hasSwitch: name => switches.has(name), getSwitchValue: name => switches.get(name),
    }});
    const contents = id => Object.assign(new EventEmitter(), {id, mainFrame: {url: origin + "/stage/build/app/"}, sent: [], destroyed: false, zoom: 1,
        isDestroyed() { return this.destroyed; }, getZoomFactor() { return this.zoom; },
        send(...args) { this.sent.push(structuredClone(args)); }});
    const owner = contents(1);
    const win = Object.assign(new EventEmitter(), {webContents: owner, destroyed: false, focused: true, visible: true, minimized: false,
        isDestroyed() { return this.destroyed; }, isFocused() { return this.focused; },
        isVisible() { return this.visible; }, isMinimized() { return this.minimized; }});
    const target = {origin, mode};
    app.on("web-contents-created", (_event, guest) => guest.setWindowOpenHandler(() => ({action: "allow"})));
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
    manager.registerOwner(owner);
    const event = () => ({sender: owner, senderFrame: owner.mainFrame});
    const attach = (descriptor, overrides = {}) => {
        const params = {src: descriptor.src, partition: descriptor.partition, ...overrides.params};
        const preferences = {nodeIntegration: true, sandbox: false, preload: "/untrusted.js", ...overrides.preferences};
        const attachEvent = {sender: owner, prevented: false, preventDefault() { this.prevented = true; }, ...overrides.event};
        owner.emit("will-attach-webview", attachEvent, preferences, params);
        if (attachEvent.prevented) return {attachEvent, preferences};
        const guest = Object.assign(contents(500 + guests.length), {session: preferences.session, hostWebContents: owner,
            url: descriptor.src, getType: () => "webview", getLastWebPreferences: () => preferences,
            getURL() { return this.url; },
            setWindowOpenHandler(handler) { this.openHandler = handler; order.push("openHandler"); },
            setBackgroundThrottling(value) { this.throttling = value; order.push("throttling:" + value); },
            postMessage(...args) { fault("portTransfer"); this.transferred = args; },
            stop() { fault("stop"); this.stopped = true; },
            close(options) { this.closeOptions = options; this.destroyed = true; this.emit("destroyed"); }, ...overrides.contents});
        guest.preferences = preferences;
        const on = guest.on;
        guest.on = function (...args) { fault("listener"); return on.apply(this, args); };
        guests.push(guest);
        if (overrides.deferCreated) return {attachEvent, preferences, guest};
        app.emit("web-contents-created", {}, guest);
        if (!guest.destroyed && !overrides.skipVerified) owner.emit("did-attach-webview", {}, guest);
        if (faults.has("earlyConsole")) {
            guest.emit("console-message", {message: "Creating a worker from 'blob:null/private' violates the following Content Security Policy directive: \"worker-src 'none'\"."});
        }
        return {attachEvent, preferences, guest};
    };
    const create = (data = {}) => {
        const descriptor = handlers["siyuan-map-create"](event(), {...envelope, provider: "openfreemap", theme: "light", ...data});
        if (autoAttach && !descriptor.error) attach(descriptor);
        return descriptor;
    };
    const command = data => handlers["siyuan-map-command"](event(), {...envelope, ...data});
    const reply = data => channels.at(-1).port1.emit("message", {data: {...envelope, ...data}});
    const load = () => guests.at(-1).emit("did-finish-load");
    return {manager, app, handlers, sessions, guests, channels, order, switches, owner, win, target, event, create, command, reply, load, faults, attach,
        setInitialized(value) { initialized = value; }};
};

const managerTest = (name, run) => {
    for (const mode of ["local", "remote"]) test(name + " (" + mode + ")", t => run(t, mode));
};

managerTest("map guest keeps an isolated memory session, secure preferences, denied external navigation and credential-free bootstrap", (_t, mode) => {
    const s = setup(undefined, mode);
    assert.equal(s.create({credentials: {apiKey: "test-key", securityCode: "test-code"}}).mode, "webview");
    const prefs = s.guests[0].preferences;
    assert.equal(prefs.sandbox, true); assert.equal(prefs.webSecurity, true); assert.equal(prefs.contextIsolation, true);
    for (const key of ["nodeIntegration", "nodeIntegrationInSubFrames", "nodeIntegrationInWorker", "webviewTag", "allowRunningInsecureContent"]) {
        assert.equal(prefs[key], false);
    }
    assert.equal(s.sessions[0].partition.startsWith("persist:"), false);
    assert.deepEqual(s.sessions[0].options, {cache: false});
    assert.deepEqual(s.order, ["openHandler", "openHandler", "openHandler"]);
    assert.deepEqual(s.guests[0].openHandler({url: "file:///etc/passwd"}), {action: "deny"});
    assert.equal(s.channels.length, 0);
    assert.equal(s.guests[0].url.includes("test-key"), false);
    s.load();
    assert.equal(s.channels[0].port1.sent.length, 0);
    s.reply({type: "ready"});
    assert.equal(s.owner.sent.length, 0);
    s.reply({type: "bootstrapReady"});
    assert.deepEqual(s.channels[0].port1.sent[0], {...envelope, type: "init", provider: "openfreemap", theme: "light"});
    s.reply({type: "bootstrapReady"});
    assert.equal(s.channels[0].port1.sent.length, 1);
    s.manager.destroyAll();
});

managerTest("only initialized registered owner main frame may create, update or destroy a map", (_t, mode) => {
    const s = setup(undefined, mode);
    const create = s.handlers["siyuan-map-create"];
    const config = {...envelope, provider: "openfreemap", theme: "light"};
    assert.throws(() => create({...s.event(), senderFrame: {}}, config));
    s.setInitialized(false); assert.throws(() => create(s.event(), config)); s.setInitialized(true);
    s.owner.mainFrame.url = "http://evil.example/stage/build/app/"; assert.throws(() => create(s.event(), config));
    s.owner.mainFrame.url = origin + "/stage/build/app/";
    s.create();
    s.handlers["siyuan-map-destroy"]({...s.event(), senderFrame: {}}, envelope);
    assert.equal(s.guests[0].destroyed, false);
    s.target.origin = "http://127.0.0.1:6807";
    s.handlers["siyuan-map-destroy"](s.event(), envelope);
    assert.equal(s.guests[0].destroyed, true, "a changed kernel origin revokes the guest");
    s.manager.destroyAll();
});

managerTest("points and clicks are bounded by current revision and membership; ready is one-shot", (_t, mode) => {
    const s = setup(undefined, mode); s.create(); s.load();
    s.command({type: "setPoints", revision: 2, points: [{id: "row", longitude: 10, latitude: 20, secret: "never"}]});
    s.reply({type: "bootstrapReady"}); s.reply({type: "ready"}); s.reply({type: "ready"});
    assert.equal(s.owner.sent.filter(entry => entry[1].type === "ready").length, 1);
    assert.deepEqual(s.channels[0].port1.sent.find(entry => entry.type === "setPoints").points,
        [{id: "row", longitude: 10, latitude: 20}]);
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

managerTest("attribution links require one recent trusted guest input in a ready visible focused map", (t, mode) => {
    let now = 100000;
    t.mock.method(Date, "now", () => now);
    const s = setup(undefined, mode); s.create(); s.load();
    const contents = s.guests[0];
    const click = () => contents.emit("before-mouse-event", {}, {type: "mouseUp", button: "left"});
    const links = () => s.owner.sent.filter(entry => entry[1].type === "attributionClick").map(entry => entry[1]);
    const visibility = {type: "visibility", visible: true, viewport: {x: 0, y: 0, width: 400, height: 300}};
    click(); s.reply({type: "attributionClick", link: "maplibre"});
    s.reply({type: "bootstrapReady"}); s.reply({type: "ready"});
    click(); s.reply({type: "attributionClick", link: "maplibre"});
    assert.deepEqual(links(), []);
    s.command(visibility);
    s.reply({type: "attributionClick", link: "maplibre"});
    assert.deepEqual(links(), [], "a provider message alone is insufficient");
    click();
    s.reply({type: "attributionClick", link: "maplibre", instanceID: "b".repeat(48)});
    s.reply({type: "attributionClick", link: "https://evil.invalid/"});
    assert.deepEqual(links(), []);
    s.reply({type: "attributionClick", link: "maplibre", href: "https://evil.invalid/"});
    s.reply({type: "attributionClick", link: "openstreetmap"});
    assert.deepEqual(links(), [{...envelope, type: "attributionClick", link: "maplibre"}]);
    contents.emit("before-input-event", {}, {type: "keyDown", key: "Enter", isAutoRepeat: false});
    s.reply({type: "attributionClick", link: "openstreetmap"});
    assert.equal(links().length, 2);
    click(); s.win.focused = false; s.win.emit("blur");
    assert.equal(s.channels[0].port1.sent.filter(value => value.type === "visibility").at(-1).visible, true,
        "switching applications keeps the visible map painted");
    s.reply({type: "attributionClick", link: "maplibre"});
    click(); s.reply({type: "attributionClick", link: "maplibre"});
    contents.emit("before-input-event", {}, {type: "keyDown", key: "Enter", isAutoRepeat: false});
    s.reply({type: "attributionClick", link: "maplibre"});
    assert.equal(links().length, 2, "an unfocused visible map cannot authorize an attribution link");
    s.win.focused = true; s.win.emit("focus");
    s.reply({type: "attributionClick", link: "maplibre"});
    assert.equal(links().length, 2, "blur invalidates an outstanding gesture even after focus returns");
    click(); s.command({type: "visibility", visible: false});
    s.reply({type: "attributionClick", link: "maplibre"});
    s.command(visibility);
    s.reply({type: "attributionClick", link: "maplibre"});
    assert.equal(links().length, 2, "hidden visibility invalidates an outstanding gesture");
    click(); now += 1001; s.reply({type: "attributionClick", link: "maplibre"});
    assert.equal(links().length, 2, "expired guest input cannot open a link");
    s.command({type: "visibility", visible: true, viewport: {x: 0, y: 0, width: 400, height: 300}});
    const sent = s.channels[0].port1.sent.filter(message => message.type === "visibility");
    assert.deepEqual(sent.map(message => message.visible), [false, true, false, true]);
    assert.deepEqual(sent[1].viewport, {x: 0, y: 0, width: 400, height: 300});
    s.manager.destroyAll();
    assert.equal(contents.listenerCount("before-mouse-event"), 0);
    assert.equal(contents.listenerCount("before-input-event"), 0);
});

managerTest("known host diagnostics are bounded fixed codes and stop on disposal", (_t, mode) => {
    const s = setup(undefined, mode); s.create();
    const contents = s.guests[0];
    const message = "Content Security Policy worker-src 'none'; https://secret.invalid/?key=private";
    contents.emit("console-message", {message});
    contents.emit("console-message", {message});
    contents.emit("console-message", {message: "unclassified private detail"});
    assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "diagnostic", code: "cspWorker"}]);
    s.manager.destroyAll();
    contents.emit("console-message", {message: "WebGL initialization failed"});
    assert.equal(s.owner.sent.length, 1);
});

managerTest("CSP resources are captured before load, deduplicated by category and isolated from the map port", (_t, mode) => {
    const s = setup("earlyConsole", mode); s.create();
    assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "diagnostic", code: "cspWorker", resource: "blob"}]);
    const contents = s.guests[0];
    const emit = url => contents.emit("console-message", {}, 2,
        `Connecting to '${url}' violates the following Content Security Policy directive: "connect-src https://tiles.openfreemap.org".`);
    emit("https://tiles.openfreemap.org/path?key=secret");
    emit("https://tiles.openfreemap.org/another?key=another-secret");
    emit("blob:null/private");
    for (let index = 0; index < 100; index++) emit(`https://unknown-${index}.invalid/secret`);
    assert.deepEqual(s.owner.sent.map(entry => entry[1].resource), ["blob", "https:tiles.openfreemap.org", "blob", "redacted"]);
    assert.equal(JSON.stringify(s.owner.sent).includes("secret"), false);
    const count = s.owner.sent.length;
    s.load();
    s.reply({type: "diagnostic", code: "cspWorker", resource: "https:tiles.openfreemap.org"});
    s.owner.emit("console-message", {message: "Content Security Policy worker-src 'none'"});
    assert.equal(s.owner.sent.length, count, "only the known map contents can contribute diagnostics");
    s.manager.destroyAll();
    emit("http://tiles.openfreemap.org/private");
    assert.equal(s.owner.sent.length, count);
});

managerTest("unapproved CSP hostnames redact and deduplicate without entering public diagnostics", (_t, mode) => {
    const s = setup(undefined, mode); s.create();
    const contents = s.guests[0];
    for (let index = 0; index < 100; index++) {
        contents.emit("console-message", {message: `Connecting to 'https://map${index}.openfreemap.org/private?key=secret' violates the following Content Security Policy directive: "connect-src https://tiles.openfreemap.org".`});
    }
    assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "diagnostic", code: "cspConnect", resource: "redacted"}]);
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

managerTest("destroy and owner navigation close real contents, ports, requests and session; stale events cannot resurrect", (_t, mode) => {
    const s = setup(undefined, mode); s.create(); s.load(); s.reply({type: "bootstrapReady"});
    s.owner.emit("did-start-navigation", {isMainFrame: true, isSameDocument: false});
    assert.equal(s.guests[0].destroyed, true);
    assert.deepEqual(s.guests[0].closeOptions, {waitForBeforeUnload: false});
    assert.equal(s.channels[0].port1.closed, true); assert.equal(s.channels[0].port2.closed, true);
    assert.equal(s.sessions[0].cleanup.length, 5);
    s.reply({type: "ready"}); assert.equal(s.owner.sent.length, 0);
    s.manager.destroyAll(); assert.equal(s.sessions[0].cleanup.length, 5);
    s.create({instanceID: "b".repeat(48)});
    assert.notEqual(s.sessions[0].partition, s.sessions[1].partition);
    s.manager.destroyAll();
});

managerTest("unsafe effective switches reject creation and duplicate instance IDs cannot replace a running host", (_t, mode) => {
    const s = setup(undefined, mode); s.switches.set("disable-web-security", "");
    assert.equal(s.create().error, "unsupportedEnvironment"); assert.equal(s.guests.length, 0);
    s.switches.clear(); s.create(); assert.equal(s.create().error, "hostLimitReached"); assert.equal(s.guests.length, 1);
    s.manager.destroyAll();
});

managerTest("capability is credential-free and only supports trusted owners with safe process switches", (_t, mode) => {
    const s = setup(undefined, mode);
    const capability = s.handlers["siyuan-map-capability"];
    assert.deepEqual(capability(s.event()), {version: 1, supported: true});
    assert.deepEqual(capability({...s.event(), senderFrame: {}}), {version: 1, supported: false, reason: "notMainFrame"});
    s.switches.set("no-sandbox", "");
    assert.deepEqual(capability(s.event()), {version: 1, supported: false, reason: "unsafeProcessSwitches"});
    assert.equal(s.guests.length, 0);
});

managerTest("Electron's default file-access switch permits the HTTP map host while file access stays denied", async (_t, mode) => {
    const s = setup(undefined, mode);
    s.switches.set("allow-file-access-from-files", "");
    assert.deepEqual(s.handlers["siyuan-map-capability"](s.event()), {version: 1, supported: true});
    assert.equal(s.create().mode, "webview");
    const ses = s.sessions[0];
    assert.equal((await ses.protocols.file(new Request("file:///etc/passwd"))).status, 403);
    assert.equal(ses.before({url: "file:///etc/passwd", resourceType: "mainFrame"}).cancel, true);
    assert.equal(ses.before({url: "file:///etc/passwd", resourceType: "xhr"}).cancel, true);
    s.owner.mainFrame.url = "file:///app/index.html";
    assert.equal(s.handlers["siyuan-map-capability"](s.event()).supported, false);
    s.manager.destroyAll();
});

managerTest("navigation, redirects, client certificates, login and renderer failure are blocked", (_t, mode) => {
    const s = setup(undefined, mode); s.create(); const wc = s.guests[0];
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

managerTest("main-process provider fetch cannot select client certificates or authenticate, including null WebContents", async (_t, mode) => {
    const s = setup(undefined, mode); s.create();
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

managerTest("a closed runtime port destroys the map instead of retaining a live orphan renderer", (_t, mode) => {
    const s = setup(undefined, mode); s.create(); s.load();
    s.channels[0].port1.emit("close");
    assert.equal(s.guests[0].destroyed, true);
    assert.equal(s.owner.sent[0][1].code, "hostPortClosed");
});

managerTest("bootstrap and SDK receive separate deadlines and duplicate bootstrap cannot extend SDK lifetime", (t, mode) => {
    t.mock.timers.enable({apis: ["setTimeout"]});
    const s = setup(undefined, mode); s.create(); s.load();
    t.mock.timers.tick(29000);
    s.reply({type: "bootstrapReady"});
    t.mock.timers.tick(39000);
    assert.equal(s.guests[0].destroyed, false, "both SDK phases retain their own 20-second budget");
    assert.deepEqual(s.owner.sent, []);
    s.reply({type: "bootstrapReady"});
    t.mock.timers.tick(5999);
    assert.equal(s.guests[0].destroyed, false);
    t.mock.timers.tick(1);
    assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "error", code: "hostSDKTimeout"}]);
    assert.equal(s.guests[0].destroyed, true);
    assert.equal(s.channels[0].port1.closed, true);
});

managerTest("document and bootstrap timeouts have distinct final codes and successful ready clears all deadlines", (t, mode) => {
    t.mock.timers.enable({apis: ["setTimeout"]});
    for (const loaded of [false, true]) {
        const s = setup(undefined, mode); s.create();
        if (loaded) s.load();
        t.mock.timers.tick(29999);
        assert.deepEqual(s.owner.sent, []);
        t.mock.timers.tick(1);
        assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "error",
            code: loaded ? "hostBootstrapTimeout" : "hostDocumentLoadTimeout"}]);
        assert.equal(s.guests[0].destroyed, true);
    }
    const s = setup(undefined, mode); s.create(); s.load();
    t.mock.timers.tick(29000); s.reply({type: "bootstrapReady"});
    t.mock.timers.tick(39999); s.reply({type: "ready"});
    t.mock.timers.tick(90000);
    assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "ready"}]);
    assert.equal(s.guests[0].destroyed, false);
    s.manager.destroyAll();
});

managerTest("creation failures return fixed stage codes and release every resource already allocated", (_t, mode) => {
    for (const point of ["session", "router"]) {
        const s = setup(point, mode);
        assert.deepEqual(s.create(), {...envelope, error: "hostSetupFailed"}, point);
        for (const ses of s.sessions) assert.equal(ses.cleanup.length, 5, point);
        assert.equal(s.guests.length, 0);
        assert.equal(JSON.stringify(s.owner.sent).includes("secret"), false, point);
        s.faults.clear();
        assert.equal(s.create().mode, "webview", "a failed instance must not occupy its slot: " + point);
        s.manager.destroyAll();
    }
});

managerTest("guest listener setup failure closes the guest and releases the reservation", (_t, mode) => {
    const s = setup("listener", mode);
    assert.equal(s.create().mode, "webview");
    assert.equal(s.guests[0].destroyed, true);
    assert.equal(s.guests[0].eventNames().length, 0);
    assert.equal(s.sessions[0].cleanup.length, 5);
    assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "error", code: "hostAttachFailed"}]);
    s.faults.clear();
    assert.equal(s.create().mode, "webview");
    s.manager.destroyAll();
});

managerTest("main-frame load failure reports document failure without waiting for the deadline", (_t, mode) => {
    const s = setup(undefined, mode); s.create();
    s.guests[0].emit("did-fail-load", {}, -2, "secret", "https://private.invalid/?key=secret", false);
    assert.deepEqual(s.owner.sent, []);
    s.guests[0].emit("did-fail-load", {}, -2, "secret", "https://private.invalid/?key=secret", true);
    assert.equal(s.owner.sent.at(-1)[1].code, "hostDocumentLoadFailed");
    assert.equal(JSON.stringify(s.owner.sent).includes("secret"), false);
    assert.equal(s.guests[0].destroyed, true);
});

managerTest("unexpected document, reload, destruction and bootstrap rejection retain their final failure reason", (_t, mode) => {
    const cases = [
        ["hostDocumentMismatch", s => { s.guests[0].url += "unexpected"; s.load(); }],
        ["hostDocumentReloaded", s => { s.load(); s.load(); }],
        ["hostDestroyed", s => { s.guests[0].destroyed = true; s.guests[0].emit("destroyed"); }],
        ["hostBootstrapFailed", s => { s.load(); s.reply({type: "error", code: "hostUnavailable"}); }],
        ["hostOperationFailed", s => { s.load(); s.reply({type: "bootstrapReady"}); s.reply({type: "error", code: "hostUnavailable"}); }],
    ];
    for (const [code, trigger] of cases) {
        const s = setup(undefined, mode); s.create(); trigger(s);
        assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "error", code}]);
        assert.equal(s.guests[0].destroyed, true);
        s.manager.destroyAll();
        assert.equal(s.owner.sent.length, 1, "disposal must not manufacture another hostDestroyed failure");
    }
});

managerTest("port setup and message failures close both endpoints and preserve the fixed failure stage", (_t, mode) => {
    for (const point of ["channel", "portListener", "portStart", "portTransfer"]) {
        const s = setup(undefined, mode); s.create(); s.faults.add(point); s.load();
        assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "error", code: "hostPortSetupFailed"}], point);
        assert.equal(s.guests[0].destroyed, true, point);
        for (const channel of s.channels) {
            assert.equal(channel.port1.closed, true, point);
            assert.equal(channel.port2.closed, true, point);
        }
    }
    for (const ready of [false, true]) {
        const s = setup(undefined, mode); s.create(); s.load();
        if (ready) s.reply({type: "bootstrapReady"});
        s.faults.add("portPost");
        s.reply({type: ready ? "ready" : "bootstrapReady"});
        assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "error", code: "hostOperationFailed"}]);
        assert.equal(s.guests[0].destroyed, true);
        assert.equal(s.guests[0].throttling, false, "a failed post must not continue ready operations");
    }
});

managerTest("renderer closure still runs when stopping it throws", (_t, mode) => {
    const s = setup(undefined, mode); s.create(); s.load();
    s.faults.add("stop");
    s.channels[0].port1.emit("close");
    assert.deepEqual(s.owner.sent.map(entry => entry[1]), [{...envelope, type: "error", code: "hostPortClosed"}]);
    assert.equal(s.guests[0].destroyed, true);
    assert.equal(s.sessions[0].cleanup.length, 5);
    assert.equal(s.channels[0].port1.closed, true);
    assert.equal(s.channels[0].port2.closed, true);
});

managerTest("main wiring removes only the process security bypass and never enables remote on map contents", () => {
    const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
    assert.ok(!source.includes('appendSwitch("disable-web-security")'));
    assert.match(source, /createMapHostManager\(/);
    assert.match(source, /webSecurity: kernelTarget.mode === "remote"/);
    const manager = fs.readFileSync(path.join(__dirname, "mapHostManager.js"), "utf8");
    assert.ok(!manager.includes("remote.enable"));
    assert.ok(!manager.includes("executeJavaScript"));
    assert.ok(!manager.includes("session.defaultSession"));
});


managerTest("capability reports bounded reasons for every owner rejection without weakening creation", (_t, mode) => {
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
        const s = setup(undefined, mode), event = s.event();
        change(s, event);
        assert.deepEqual(s.handlers["siyuan-map-capability"](event), {version: 1, supported: false, reason});
        assert.throws(() => s.handlers["siyuan-map-create"](event, {...envelope, provider: "openfreemap", theme: "light"}));
        assert.equal(s.guests.length, 0);
        s.manager.destroyAll();
    }
});

const readyWebview = s => {
    const descriptor = s.create();
    const attached = s.attach(descriptor);
    assert.equal(attached.attachEvent.prevented, false);
    assert.equal(attached.guest.destroyed, false);
    attached.guest.emit("did-finish-load");
    s.reply({type: "bootstrapReady"});
    s.reply({type: "ready"});
    s.command({type: "visibility", visible: true, viewport: {x: 0, y: 0, width: 400, height: 300}});
    return {...attached, descriptor};
};

managerTest("owner registration guards attachments before map creation and stays idempotent", (_t, mode) => {
    const s = setup(undefined, mode, false);
    s.manager.registerOwner(s.owner);
    assert.equal(s.owner.listenerCount("will-attach-webview"), 1);
    assert.equal(s.owner.listenerCount("did-attach-webview"), 1);
    s.setInitialized(false);
    s.owner.mainFrame.url = "about:blank";
    for (const params of [undefined, {}, {src: origin + "/stage/map/index.html?provider=openfreemap"},
        {src: "https://example.invalid/", partition: "plugin-session"},
        {src: "https://example.invalid/", partition: "persist:siyuan-map-forged"},
        {src: "https://example.invalid/", partition: "siyuan-map-forged"}]) {
        const event = {sender: s.owner, prevented: false, preventDefault() { this.prevented = true; }};
        const preferences = {sandbox: false, preload: "/plugin.js"};
        s.owner.emit("will-attach-webview", event, preferences, params);
        assert.equal(event.prevented, mode === "remote" || params?.partition === "siyuan-map-forged");
        assert.deepEqual(preferences, {sandbox: false, preload: "/plugin.js"});
    }
    s.target.mode = "unknown";
    assert.equal(s.attach({src: "https://example.invalid/", partition: "ordinary"}).attachEvent.prevented, true);
    s.owner.emit("destroyed");
    assert.equal(s.owner.listenerCount("will-attach-webview"), 0);
    assert.equal(s.owner.listenerCount("did-attach-webview"), 0);
    s.manager.destroyAll();
});

managerTest("unreserved created or attached guests obey the current owner's default policy", (_t, mode) => {
    for (const phase of ["created", "attached"]) {
        const s = setup(undefined, mode, false);
        const guest = {session: {}, hostWebContents: s.owner, getType: () => "webview",
            isDestroyed() { return !!this.destroyed; },
            setWindowOpenHandler(value) { this.openHandler = value; }, close() { this.destroyed = true; }};
        if (phase === "created") s.app.emit("web-contents-created", {}, guest);
        else s.owner.emit("did-attach-webview", {}, guest);
        assert.equal(!!guest.destroyed, mode === "remote", phase);
        if (mode === "remote") assert.deepEqual(guest.openHandler({url: "https://example.invalid/"}), {action: "deny"});
        s.manager.destroyAll();
    }
});

managerTest("a reservation is bound to its owner, exact entry URL and memory partition", (_t, mode) => {
    const s = setup(undefined, mode, false), descriptor = s.create();
    const otherOwner = Object.assign(new EventEmitter(), {id: 2});
    s.manager.registerOwner(otherOwner);
    const foreign = {sender: otherOwner, prevented: false, preventDefault() { this.prevented = true; }};
    otherOwner.emit("will-attach-webview", foreign, {}, {src: descriptor.src, partition: descriptor.partition});
    assert.equal(foreign.prevented, true);
    assert.equal(s.attach(descriptor, {event: {sender: otherOwner}}).attachEvent.prevented, true);
    for (const params of [{src: descriptor.src + "extra"}, {src: descriptor.src.split("#")[0]},
        {src: descriptor.src.replace("provider=openfreemap", "provider=other")},
        {partition: "siyuan-map-forged"}]) {
        assert.equal(s.attach(descriptor, {params}).attachEvent.prevented, true);
    }
    const {guest} = s.attach(descriptor);
    assert.equal(guest.destroyed, false, "foreign attempts cannot consume the owner's reservation");
    assert.equal(s.attach(descriptor).attachEvent.prevented, true);
    s.manager.destroyAll();
});

managerTest("changing target mode revokes pending and admitted reservations before they can be reused", (_t, mode) => {
    for (const phase of ["reserved", "accepted", "attached", "ready"]) {
        const s = setup(undefined, mode, false), descriptor = s.create();
        let guest;
        if (phase !== "reserved") ({guest} = s.attach(descriptor, {deferCreated: phase === "accepted"}));
        if (phase === "ready") {
            guest.emit("did-finish-load");
            s.reply({type: "bootstrapReady"}); s.reply({type: "ready"});
        }
        s.target.mode = mode === "local" ? "remote" : "local";
        if (phase === "reserved") assert.equal(s.attach(descriptor).attachEvent.prevented, true);
        if (phase === "accepted") s.app.emit("web-contents-created", {}, guest);
        if (phase === "attached") guest.emit("did-finish-load");
        if (phase === "ready") s.command({type: "theme", theme: "dark"});
        if (guest) assert.equal(guest.destroyed, true, phase);
        if (phase !== "ready") assert.equal(s.channels.length, 0, phase);
        else assert.equal(s.channels[0].port1.closed, true);
        assert.equal(s.sessions[0].cleanup.length, 5, phase);
        assert.equal(s.attach(descriptor).attachEvent.prevented, true, "revoked partitions cannot be reused");
        const replacement = s.create();
        assert.equal(replacement.mode, "webview");
        assert.notEqual(replacement.partition, descriptor.partition);
        assert.equal(s.attach(replacement).guest.destroyed, false);
        s.manager.destroyAll();
    }
});

managerTest("map reserves one fixed memory guest and installs its deny policy before first load", (_t, mode) => {
    const s = setup(undefined, mode, false);
    const descriptor = s.create({mode: "native", src: "https://evil.invalid/", partition: "persist:evil"});
    assert.equal(descriptor.mode, "webview");
    assert.match(descriptor.partition, /^siyuan-map-[a-f0-9]{48}$/);
    assert.match(descriptor.src, new RegExp("^" + origin + "/stage/map/index.html\\?provider=openfreemap#" + instanceID + ":[a-f0-9]{48}$"));
    assert.equal(s.guests.length, 0);
    assert.equal(s.channels.length, 0);
    const {guest, preferences} = s.attach(descriptor);
    assert.equal(guest.session, s.sessions[0]);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.sandbox, true);
    assert.match(preferences.preload, /mapHostPreload\.js$/);
    assert.deepEqual(guest.openHandler({url: "https://evil.invalid/"}), {action: "deny"}, "the earlier generic external opener is overridden before loading");
    for (const name of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
        let prevented = false;
        guest.emit(name, {preventDefault() { prevented = true; }});
        assert.equal(prevented, true, name);
    }
    assert.equal(s.channels.length, 0);
    guest.emit("did-finish-load");
    assert.equal(s.channels.length, 1);
    assert.equal(guest.transferred[0], "siyuan-map-port");
    s.reply({type: "bootstrapReady"}); s.reply({type: "ready"});
    assert.deepEqual(s.owner.sent.at(-1)[1], {...envelope, type: "ready"});
    assert.equal(s.attach(descriptor).attachEvent.prevented, true, "attachment permission is single use");
    s.manager.destroyAll();
    assert.equal(guest.destroyed, true);
    assert.equal(s.sessions[0].cleanup.length, 5);
});

managerTest("guest initial zoom uses the verified owner after clearing untrusted preferences", (_t, mode) => {
    for (const zoom of [0.25, 1.25, 5]) {
        const s = setup(undefined, mode, false);
        s.owner.zoom = zoom;
        const {attachEvent, guest, preferences} = s.attach(s.create(), {preferences: {zoomFactor: 99}});
        assert.equal(attachEvent.prevented, false);
        assert.equal(guest.destroyed, false);
        assert.equal(preferences.zoomFactor, zoom);
        assert.equal(preferences.sandbox, true);
        s.manager.destroyAll();
    }
});

managerTest("every security preference mismatch rejects a guest before bootstrap", (_t, mode) => {
    for (const preference of ["sandbox", "contextIsolation", "webSecurity", "nodeIntegration", "nodeIntegrationInSubFrames",
        "nodeIntegrationInWorker", "webviewTag", "allowRunningInsecureContent", "experimentalFeatures", "disablePopups",
        "safeDialogs", "disableDialogs"]) {
        const s = setup(undefined, mode, false), descriptor = s.create();
        const {guest} = s.attach(descriptor, {contents: {
            getLastWebPreferences: () => ({...MAP_WEBVIEW_PREFERENCES, [preference]: !MAP_WEBVIEW_PREFERENCES[preference]}),
        }});
        assert.equal(guest.destroyed, true, preference);
        assert.equal(s.channels.length, 0, preference);
        assert.equal(s.sessions[0].cleanup.length, 5, preference);
        assert.equal(s.owner.sent.at(-1)[1].code, "hostAttachFailed", preference);
        s.manager.destroyAll();
    }
});

managerTest("guest rejects invalid or unavailable owner zoom and releases its reservation", (_t, mode) => {
    for (const zoom of [undefined, "1.25", NaN, Infinity, -Infinity, 0, -1, 0.249, 5.001, "throws"]) {
        const s = setup(undefined, mode, false), descriptor = s.create();
        s.owner.getZoomFactor = () => {
            if (zoom === "throws") throw new Error("destroyed");
            return zoom;
        };
        const {attachEvent, guest} = s.attach(descriptor, {preferences: {zoomFactor: 1.25}});
        assert.equal(attachEvent.prevented, true);
        assert.equal(guest, undefined);
        assert.equal(s.channels.length, 0);
        assert.equal(s.sessions[0].cleanup.length, 5);
        assert.deepEqual(s.owner.sent.at(-1)[1], {...envelope, type: "error", code: "hostAttachFailed"});
        s.owner.getZoomFactor = () => 1;
        assert.equal(s.attach(descriptor).attachEvent.prevented, true, "failed reservations cannot be reused");
        s.manager.destroyAll();
    }
});

managerTest("attachment guards reject map forgeries and preserve the target-specific ordinary webview policy", (_t, mode) => {
    const s = setup(undefined, mode, false), descriptor = s.create();
    for (const params of [{src: origin + "/api/private"}, {preload: "file:///private.js"}, {nodeintegration: true},
        {webpreferences: "sandbox=false"}, {disablewebsecurity: true}]) {
        assert.equal(s.attach(descriptor, {params}).attachEvent.prevented, true);
    }
    const ordinary = {sender: s.owner, prevented: false, preventDefault() { this.prevented = true; }};
    const ordinaryPrefs = {nodeIntegration: true};
    s.owner.emit("will-attach-webview", ordinary, ordinaryPrefs, {src: "https://example.invalid/", partition: "plugin-session"});
    assert.equal(ordinary.prevented, mode === "remote");
    assert.deepEqual(ordinaryPrefs, {nodeIntegration: true});
    const {guest} = s.attach(descriptor);
    const second = Object.assign(new EventEmitter(), {session: s.sessions[0], hostWebContents: {},
        getType: () => "webview", getLastWebPreferences: () => ({}),
        isDestroyed() { return !!this.destroyed; },
        setWindowOpenHandler(value) { this.openHandler = value; }, close() { this.destroyed = true; }});
    s.app.emit("web-contents-created", {}, second);
    assert.equal(second.destroyed, true);
    assert.deepEqual(second.openHandler({url: "https://evil.invalid/"}), {action: "deny"});
    assert.equal(guest.destroyed, false, "a foreign duplicate cannot revoke the admitted guest");
    s.manager.destroyAll();
});

managerTest("pending attachments close immediately on owner loss and cannot be revived by late guest creation", (_t, mode) => {
    for (const invalidate of [
        s => s.owner.emit("did-start-navigation", {isMainFrame: true, isSameDocument: false}),
        s => s.owner.emit("destroyed"),
        s => s.owner.emit("render-process-gone"),
        s => s.win.emit("closed"),
        s => s.handlers["siyuan-map-destroy"](s.event(), envelope),
    ]) {
        const s = setup(undefined, mode, false), descriptor = s.create();
        const {guest} = s.attach(descriptor, {deferCreated: true});
        invalidate(s);
        assert.equal(s.sessions[0].cleanup.length, 5);
        s.app.emit("web-contents-created", {}, guest);
        assert.equal(guest.destroyed, true);
        assert.deepEqual(guest.openHandler({url: "https://evil.invalid/"}), {action: "deny"});
        assert.equal(s.channels.length, 0);
        s.manager.destroyAll();
    }
});

managerTest("unattached map reservation uses the existing fixed bootstrap deadline", (t, mode) => {
    t.mock.timers.enable({apis: ["setTimeout"]});
    const s = setup(undefined, mode, false), descriptor = s.create();
    t.mock.timers.tick(29999);
    assert.equal(s.sessions[0].cleanup.length, 0);
    t.mock.timers.tick(1);
    assert.equal(s.sessions[0].cleanup.length, 5);
    assert.equal(s.owner.sent.at(-1)[1].code, "hostDocumentLoadTimeout");
    assert.equal(s.attach(descriptor).attachEvent.prevented, true);
    s.manager.destroyAll();
});

managerTest("guest visibility is bounded and survives resize without native geometry or menu handlers", (_t, mode) => {
    const s = setup(undefined, mode, false), {guest} = readyWebview(s);
    const visibility = () => s.channels[0].port1.sent.filter(item => item.type === "visibility");
    const dismiss = () => s.owner.sent.filter(item => item[1].type === "dismissMenu");
    const mouse = () => guest.emit("before-mouse-event", {preventDefault() { assert.fail("map input must continue"); }}, {type: "mouseDown"});
    assert.equal(visibility().at(-1).visible, true);
    for (const name of ["resize", "enter-full-screen", "leave-full-screen"]) s.win.emit(name);
    s.owner.emit("zoom-changed");
    mouse();
    assert.equal(dismiss().length, 1);
    assert.equal(s.handlers["siyuan-map-geometry"], undefined);
    assert.equal(s.handlers["siyuan-map-unplaced-open"], undefined);
    s.win.visible = false; s.win.emit("hide"); mouse();
    assert.equal(dismiss().length, 1);
    assert.equal(visibility().at(-1).visible, false);
    s.win.visible = true; s.win.emit("show"); mouse();
    assert.equal(dismiss().length, 2);
    assert.equal(visibility().at(-1).visible, true);
    s.command({type: "visibility", visible: true, viewport: {x: 0, y: 0, width: Infinity, height: 3}});
    assert.equal(visibility().at(-1).viewport.width, 400);
    s.command({type: "visibility", visible: false}); mouse();
    assert.equal(dismiss().length, 2);
    assert.equal(s.guests.length, 1);
    s.manager.destroyAll();
});

managerTest("hidden bootstrap gets frames while window and DOM visibility remain authoritative", (_t, mode) => {
    const s = setup(undefined, mode); s.create(); s.load();
    const guest = s.guests[0];
    const visible = {type: "visibility", visible: true, viewport: {x: 0, y: 0, width: 400, height: 300}};
    const visibility = () => s.channels[0].port1.sent.filter(value => value.type === "visibility");
    assert.equal(guest.preferences.backgroundThrottling, false);
    assert.equal(guest.throttling, false);
    s.command(visible);
    assert.equal(visibility().length, 0, "the provider cannot receive a visible state before ready");
    s.command({type: "visibility", visible: false});
    s.reply({type: "bootstrapReady"}); s.reply({type: "ready"});
    assert.equal(guest.throttling, true);
    assert.equal(visibility().at(-1).visible, false);
    s.win.focused = false; s.win.emit("blur"); s.command(visible);
    assert.equal(visibility().at(-1).visible, true, "an unfocused visible window can paint the map");
    for (const [property, hiddenValue, hide, restore] of [
        ["visible", false, "hide", "show"], ["minimized", true, "minimize", "restore"],
    ]) {
        s.win[property] = hiddenValue; s.win.emit(hide);
        assert.equal(visibility().at(-1).visible, false);
        s.command(visible); s.win.emit("focus");
        assert.equal(visibility().at(-1).visible, false, "owner commands cannot expose a hidden window");
        s.win[property] = !hiddenValue; s.win.emit(restore);
        assert.equal(visibility().at(-1).visible, true);
    }
    s.command({type: "visibility", visible: false});
    s.win.focused = true; s.win.emit("focus");
    assert.equal(visibility().at(-1).visible, false, "focus cannot revive an owner-occluded map");
    s.manager.destroyAll();
});

managerTest("only current trusted guest input dismisses DOM menus; guest replies and revoked owners cannot", (_t, mode) => {
    const s = setup(undefined, mode, false), {guest} = readyWebview(s);
    const dismiss = () => s.owner.sent.filter(item => item[1].type === "dismissMenu");
    s.reply({type: "dismissMenu"});
    assert.equal(dismiss().length, 0);
    guest.emit("before-mouse-event", {}, {type: "mouseDown"});
    assert.deepEqual(dismiss().map(item => item[1]), [{...envelope, type: "dismissMenu"}]);
    s.win.focused = false; guest.emit("before-mouse-event", {}, {type: "mouseDown"}); s.win.focused = true;
    s.setInitialized(false); guest.emit("before-mouse-event", {}, {type: "mouseDown"}); s.setInitialized(true);
    s.target.mode = mode === "local" ? "remote" : "local"; guest.emit("before-mouse-event", {}, {type: "mouseDown"});
    assert.equal(dismiss().length, 1);
    s.reply({type: "markerClick", id: "row", revision: 1});
    assert.equal(guest.destroyed, true, "mode changes revoke the old guest before accepting any reply");
    s.manager.destroyAll();
});

managerTest("guest load requires verified attachment and exact one-shot document identity", (_t, mode) => {
    for (const failure of ["unverified", "hash", "other-document", "reload"]) {
        const s = setup(undefined, mode, false), descriptor = s.create();
        const {guest} = s.attach(descriptor, {skipVerified: failure === "unverified"});
        guest.emit("did-finish-load");
        if (failure === "hash") guest.emit("did-navigate-in-page");
        if (failure === "other-document") guest.emit("did-navigate", {}, origin + "/api/private");
        if (failure === "reload") guest.emit("did-finish-load");
        assert.equal(guest.destroyed, true, failure);
        if (s.channels.length) assert.equal(s.channels[0].port1.closed, true);
        assert.equal(s.sessions[0].cleanup.length, 5);
        s.manager.destroyAll();
    }
});

managerTest("kernel target mode is authoritative and unknown modes are not registered owners", (_t, mode) => {
    const s = setup(undefined, mode);
    assert.equal(s.create({mode: "native"}).mode, "webview");
    s.manager.destroyAll();
    delete s.target.mode;
    assert.equal(s.handlers["siyuan-map-capability"](s.event()).reason, "unregisteredOwner");
    assert.throws(() => s.create());
});

managerTest("guest readback and closure races cannot escape Electron attachment callbacks", (_t, mode) => {
    for (const phase of ["created", "attached", "close-throws"]) {
        const s = setup(undefined, mode, false), descriptor = s.create();
        let reads = 0;
        let attached;
        assert.doesNotThrow(() => {
            attached = s.attach(descriptor, {contents: {
                getLastWebPreferences() {
                    reads++;
                    if (phase !== "attached" || reads > 1) throw new Error("Object has been destroyed");
                    return MAP_WEBVIEW_PREFERENCES;
                },
                close() {
                    if (phase === "close-throws") throw new Error("Object has been destroyed");
                    this.destroyed = true;
                    this.emit("destroyed");
                },
            }});
        }, phase);
        assert.equal(s.channels.length, 0, phase);
        assert.equal(s.sessions[0].cleanup.length, 5, phase);
        assert.equal(s.owner.sent.at(-1)[1].code, "hostAttachFailed", phase);
        if (phase !== "close-throws") assert.equal(attached.guest.destroyed, true);
        s.manager.destroyAll();
    }
    const s = setup(undefined, mode, false);
    assert.doesNotThrow(() => s.app.emit("web-contents-created", {}, {
        setWindowOpenHandler() {}, isDestroyed: () => true,
        getType() { throw new Error("Object has been destroyed"); },
    }));
    s.manager.destroyAll();
});
