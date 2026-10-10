const assert = require("node:assert/strict");
const {test} = require("node:test");
const {EventEmitter} = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const {ORIGIN, CHANNEL, CSP, parseState, parseAction, resource, place} = require("../electron/mapUnplaced/policy");
const {createRouter, createManager} = require("../electron/mapUnplaced/manager");
const resourceDirectory = path.join(__dirname, "../electron/mapUnplaced");
const fixtureDirectory = path.join(__dirname, "fixtures/map-unplaced-overlay");
const ownerURL = "file:///fixture/owner.html";
const state = (extra = {}) => ({revision: 1, requestID: 0, query: "", rows: [{id: "row-1", title: "Private <img src=x>"}],
    total: 123, page: 1, loading: false, error: false, theme: {mode: "light", fontSize: 16},
    labels: {title: "List", search: "Search", empty: "Empty", loading: "Loading", more: "More", previous: "Previous", retry: "Retry", close: "Close"}, ...extra});
const anchor = {x: 100, y: 50, width: 160, height: 30};
const createSession = () => {
    const ses = Object.assign(new EventEmitter(), {handlers: {}, protocols: {}, cleanup: []});
    for (const name of ["setPermissionRequestHandler", "setPermissionCheckHandler", "setDevicePermissionHandler",
        "setDisplayMediaRequestHandler", "setCertificateVerifyProc", "allowNTLMCredentialsForDomains"]) {
        ses[name] = fn => { ses.handlers[name] = fn; };
    }
    for (const name of ["closeAllConnections", "clearStorageData", "clearAuthCache", "clearCache", "clearHostResolverCache"]) {
        ses[name] = async () => ses.cleanup.push(name);
    }
    ses.webRequest = {onBeforeRequest: fn => { ses.handlers.before = fn; },
        onBeforeSendHeaders: fn => { ses.handlers.headers = fn; }};
    ses.protocol = {handle: (scheme, fn) => { ses.protocols[scheme] = fn; }};
    return ses;
};
const createContents = url => Object.assign(new EventEmitter(), {
    mainFrame: {url}, dead: false, sent: [], focused: 0, zoom: 1,
    isDestroyed() { return this.dead; },
    getZoomFactor() { return this.zoom; },
    setZoomFactor(value) { this.zoom = value; },
    setWindowOpenHandler(fn) { this.popup = fn; },
    loadURL(value) { this.mainFrame.url = value; return Promise.resolve(); },
    focus() { this.focused++; },
    stop() {},
    close() { this.dead = true; this.emit("destroyed"); },
    send(channel, value) { this.sent.push([channel, value]); },
});
const setup = (fail = "") => {
    const ipcMain = new EventEmitter(), owner = createContents(ownerURL), map = createContents("data:synthetic");
    const sessions = [], views = [], actions = [], closed = [], children = [];
    let allowed = true, counter = 0;
    const win = Object.assign(new EventEmitter(), {bounds: {width: 800, height: 600}, visible: true,
        isDestroyed: () => false, isFocused: () => true, isVisible() { return this.visible; }, getContentBounds() { return this.bounds; },
        contentView: {addChildView(view) { if (fail === "attach") throw new Error("attach"); children.push(view); },
            removeChildView(view) { const index = children.indexOf(view); if (index >= 0) children.splice(index, 1); }}});
    const manager = createManager({ipcMain, owner, win, ownerURL, outsideContents: [map], assets: {controls: ""},
        session: {fromPartition(name) { const ses = createSession(); ses.partition = name; sessions.push(ses); return ses; }},
        WebContentsView: function (options) {
            if (fail === "constructor") throw new Error("constructor");
            const webContents = createContents("");
            if (fail === "load") webContents.loadURL = () => Promise.reject(new Error("load"));
            const view = {options, webContents, bounds: [], visibility: [],
                setBackgroundColor(value) { this.background = value; },
                setBounds(value) { if (fail === "bounds") throw new Error("bounds"); this.bounds.push(value); },
                setVisible(value) { this.visibility.push(value); }};
            views.push(view);
            return view;
        }, mayUse: () => allowed, randomID: () => (++counter).toString(16).padStart(48, "0"),
        readFile: fail === "asset" ? async () => { throw new Error("private path"); } : undefined,
        onAction: value => actions.push(value), onClose: value => closed.push(value)});
    const event = {sender: owner, senderFrame: owner.mainFrame};
    const open = value => manager.open(event, {state: state(value), anchor});
    const action = (type, extra = {}, eventOverride) => {
        const current = manager.inspect();
        const contents = current?.view.webContents || views.at(-1).webContents;
        ipcMain.emit(CHANNEL + "-action", eventOverride || {sender: contents, senderFrame: contents.mainFrame},
            {sessionID: current?.sessionID, revision: type === "ready" ? 0 : 1, type, ...extra});
    };
    return {manager, event, open, action, owner, map, win, sessions, views, actions, closed, children, ipcMain,
        revoke() { allowed = false; }};
};

test("overlay strict schemas copy bounded plain text and reject URLs, HTML fields, duplicate IDs and CSS", () => {
    const source = state(), result = parseState(source);
    assert.deepEqual(result, source);
    assert.notEqual(result.rows, source.rows);
    for (const value of [state({url: "https://evil.invalid"}), state({rows: [{id: "a", title: "x", html: "<b>"}]}),
        state({rows: [{id: "a", title: "x"}, {id: "a", title: "y"}]}), state({query: "x".repeat(257)}),
        state({theme: {mode: "dark", fontSize: 33}}), state({theme: {mode: "dark", fontSize: 16, css: "url(https://evil)"}}),
        state({revision: NaN}), state({total: -1}), state({page: 0}), state({rows: [{id: "x", title: "x".repeat(2049)}]})]) {
        assert.equal(parseState(value), undefined);
    }
    const envelope = {sessionID: "a".repeat(48), revision: 1, type: "select", id: "row-1"};
    assert.deepEqual(parseAction(envelope), envelope);
    for (const value of [{...envelope, url: "https://evil"}, {...envelope, sessionID: "bad"},
        {...envelope, revision: -1}, {...envelope, type: "execute"}]) assert.equal(parseAction(value), undefined);
    assert.equal(resource(ORIGIN + "/menu.html", "GET")[0], "menu.html");
    for (const url of [ORIGIN + "/%6denu.html", ORIGIN + "/x/../menu.html", ORIGIN + "/menu.html?x", ORIGIN + "/menu.html#x",
        "https://user@siyuan-unplaced.invalid/menu.html", "https://evil.invalid/menu.html"]) assert.equal(resource(url, "GET"), undefined);
    assert.equal(resource(ORIGIN + "/menu.html", "POST"), undefined);
    assert.doesNotMatch(CSP, /unsafe-inline|unsafe-eval/);
});

test("overlay router denies all networking, permissions, credentials, frames, repeat navigation and destroyed requests", async () => {
    const ses = createSession(), files = [];
    const router = createRouter(ses, {controls: "shared"}, async filename => { files.push(filename); return "local"; });
    const before = (url, resourceType, method = "GET") => {
        let answer;
        ses.handlers.before({url, resourceType, method}, value => { answer = value; });
        return answer.cancel;
    };
    assert.equal(before(ORIGIN + "/menu.html", "mainFrame"), false);
    assert.equal(before(ORIGIN + "/menu.html", "mainFrame"), true);
    assert.equal(before(ORIGIN + "/menu.js", "script"), false);
    for (const type of ["subFrame", "xhr", "webSocket", "other"]) assert.equal(before(ORIGIN + "/menu.js", type), true);
    for (const url of ["https://tiles.openfreemap.org/private", "http://127.0.0.1:6806/api/sql", "file:///etc/passwd", "data:text/html,hi", "blob:x"]) {
        assert.equal(before(url, "script"), true);
    }
    const response = await ses.protocols.https(new Request(ORIGIN + "/menu.html"));
    assert.equal(await response.text(), "local");
    assert.equal(response.headers.get("content-security-policy"), CSP);
    assert.deepEqual(files, [path.join(resourceDirectory, "menu.html")]);
    assert.equal((await ses.protocols.https(new Request(ORIGIN + "/menu.js", {headers: {"service-worker": "script"}}))).status, 403);
    assert.equal((await ses.protocols.http(new Request("http://127.0.0.1"))).status, 403);
    assert.equal((await ses.protocols.file()).status, 403);
    let value;
    ses.handlers.setPermissionRequestHandler({}, "clipboard-read", answer => { value = answer; });
    assert.equal(value, false);
    assert.equal(ses.handlers.setPermissionCheckHandler(), false);
    assert.equal(ses.handlers.setDevicePermissionHandler(), false);
    ses.handlers.headers({requestHeaders: {Cookie: "secret"}}, answer => { value = answer; });
    assert.deepEqual(value.requestHeaders, {});
    router.destroy();
    assert.equal(before(ORIGIN + "/menu.js", "script"), true);
    assert.equal((await ses.protocols.https(new Request(ORIGIN + "/menu.js"))).status, 403);
    assert.equal(ses.cleanup.length, 5);
});

test("overlay owner/frame/session binding, request invalidation and membership gate reject stale and foreign selections", () => {
    const f = setup();
    try {
        assert.equal(f.manager.open({...f.event, senderFrame: {}}, {state: state(), anchor}), undefined);
        const sessionID = f.open();
        f.action("ready");
        const options = f.views[0].options.webPreferences;
        assert.equal(options.sandbox, true);
        assert.equal(options.contextIsolation, true);
        assert.equal(options.nodeIntegration, false);
        assert.equal(options.webSecurity, true);
        assert.equal(options.webviewTag, false);
        assert.ok(!f.sessions[0].partition.startsWith("persist:"));
        assert.deepEqual(f.views[0].visibility, [false, true]);
        f.action("select", {id: "row-1"}, {sender: f.map, senderFrame: f.map.mainFrame});
        f.action("select", {id: "missing"});
        f.action("select", {id: "row-1", sessionID: "f".repeat(48)});
        assert.equal(f.actions.length, 0);
        f.action("editing");
        f.action("select", {id: "row-1"});
        assert.equal(f.actions.length, 1);
        assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: 2})}), false);
        f.action("search", {query: "new"});
        assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: 2, query: "old"})}), false);
        assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: 2, requestID: 2, query: "new", loading: true})}), true);
        f.action("select", {id: "row-1", revision: 2});
        assert.equal(f.actions.length, 2);
        assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: 3, requestID: 2, query: "new", rows: [{id: "new", title: "new"}]})}), true);
        f.action("select", {id: "row-1", revision: 3});
        f.action("select", {id: "new", revision: 2});
        assert.equal(f.actions.length, 2);
        f.action("select", {id: "new", revision: 3});
        assert.equal(f.actions.at(-1).id, "new");
        assert.equal(f.manager.inspect(), undefined);
        assert.equal(f.owner.focused, 1);
        const replacement = f.open();
        assert.notEqual(replacement, sessionID);
        assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: 99})}), false);
    } finally { f.manager.destroy(); }
});

test("initial loading completes and main-issued request generations reject late A-to-B-to-A results", () => {
    const f = setup();
    try {
        const sessionID = f.open({loading: true, rows: []});
        f.action("ready");
        assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: 2, query: "wrong"})}), false);
        assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: 2})}), true);
        f.action("search", {revision: 2, query: "A"});
        f.action("search", {revision: 2, query: "B"});
        f.action("search", {revision: 2, query: "A"});
        assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: 3, requestID: 1, query: "A"})}), false);
        assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: 4, requestID: 3, query: "A"})}), true);
    } finally { f.manager.destroy(); }
});

test("page replacement reaches every result beyond 500 rows and 20 pages, and previous/retry keep main-issued page identity", () => {
    const f = setup(), total = 1234;
    const rows = page => Array.from({length: Math.min(50, total - (page - 1) * 50)}, (_, index) => ({
        id: "row-" + ((page - 1) * 50 + index), title: "Record " + ((page - 1) * 50 + index),
    }));
    try {
        const sessionID = f.open({total, rows: rows(1)});
        f.action("ready");
        let revision = 1, requestID = 0;
        const seen = new Set(rows(1).map(row => row.id));
        for (let page = 2; page <= Math.ceil(total / 50); page++) {
            f.action("more", {revision});
            requestID++;
            assert.equal(f.actions.at(-1).requestID, requestID);
            assert.equal(f.actions.at(-1).page, page);
            assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: revision + 1, requestID,
                total, page: page - 1, rows: rows(page)})}), false, "same request with the previous page is stale");
            assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: ++revision, requestID,
                total, page, rows: rows(page)})}), true);
            rows(page).forEach(row => seen.add(row.id));
        }
        assert.equal(seen.size, total);
        const count = f.actions.length;
        f.action("more", {revision});
        assert.equal(f.actions.length, count, "only the actual final page disables Next");
        f.action("previous", {revision});
        requestID++;
        assert.equal(f.actions.at(-1).page, 24);
        assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: ++revision, requestID,
            total, page: 24, error: true, rows: []})}), true);
        f.action("retry", {revision});
        requestID++;
        assert.equal(f.actions.at(-1).page, 24);
        assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: ++revision, requestID,
            total, page: 24, rows: rows(24)})}), true);
        f.action("select", {revision, id: rows(25)[0].id});
        assert.ok(f.manager.inspect(), "members of a previously rendered page cannot be selected");
        f.action("select", {revision, id: rows(24)[0].id});
        assert.equal(f.manager.inspect(), undefined);
        assert.equal(f.closed.length, 0, "select uses one terminal action and no earlier closed notification");
    } finally { f.manager.destroy(); }
});

test("bounded DTOs reject oversized pages while preserving large result counts and settled query/page identity", () => {
    assert.ok(parseState(state({total: 2000000, page: 20001})));
    assert.equal(parseState(state({rows: Array.from({length: 51}, (_, index) => ({id: String(index), title: "Record"}))})), undefined);
    for (const fontSize of [12, 13, 17, 31, 32]) assert.ok(parseState(state({theme: {mode: "dark", fontSize}})));
    for (const fontSize of [11, 12.5, 33, Infinity]) assert.equal(parseState(state({theme: {mode: "dark", fontSize}})), undefined);
    const f = setup();
    try {
        const sessionID = f.open(); f.action("ready");
        for (const extra of [{query: "unexpected"}, {page: 2}, {requestID: 1}]) {
            assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: 2, ...extra})}), false);
        }
        assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: 2, theme: {mode: "dark", fontSize: 23}})}), true);
    } finally { f.manager.destroy(); }
});

test("independent theme updates never expire an in-flight edit or pagination action and cannot restore cleared row membership", () => {
    const f = setup();
    try {
        const sessionID = f.open(); f.action("ready");
        const theme = {mode: "dark", fontSize: 23};
        for (const value of [{sessionID: "f".repeat(48), theme}, {sessionID, theme: {...theme, css: "private"}},
            {sessionID, theme, revision: 2}, {sessionID, theme: {mode: "dark", fontSize: 33}}]) {
            assert.equal(f.manager.setTheme(f.event, value), false);
        }
        assert.equal(f.manager.setTheme({...f.event, senderFrame: {}}, {sessionID, theme}), false);
        assert.equal(f.manager.setTheme(f.event, {sessionID, theme}), true);
        assert.deepEqual(f.views[0].webContents.sent.at(-1), [CHANNEL + "-theme", {sessionID, theme}]);
        assert.equal(f.views[0].webContents.sent.filter(([name]) => name === CHANNEL + "-state").at(-1)[1].state.revision, 1);
        f.action("editing", {revision: 1});
        assert.equal(f.actions.at(-1).requestID, 1);
        assert.equal(f.manager.setTheme(f.event, {sessionID, theme: {mode: "light", fontSize: 32}}), true);
        f.action("select", {revision: 1, id: "row-1"});
        assert.equal(f.actions.length, 1, "theme must not restore members cleared during editing");
        f.action("search", {revision: 1, query: "latest"});
        assert.equal(f.actions.at(-1).requestID, 2);
        assert.equal(f.manager.update(f.event, {sessionID, state: state({revision: 2, requestID: 2, query: "latest"})}), true);
        assert.equal(f.manager.setTheme(f.event, {sessionID, theme}), true);
        f.action("more", {revision: 2});
        assert.equal(f.actions.at(-1).page, 2);
        assert.equal(f.actions.at(-1).requestID, 3);
    } finally { f.manager.destroy(); }
});

test("shared production resources are read only from their exact package paths including compiled controls", async () => {
    const ses = createSession(), files = [];
    const controlsPath = "/app/stage/build/map/unplaced-controls.css";
    const router = createRouter(ses, {controlsPath}, async filename => { files.push(filename); return "local"; });
    try {
        for (const resourceName of ["menu.html", "menu.js", "menu.css", "controls.css"]) {
            assert.equal((await ses.protocols.https(new Request(ORIGIN + "/" + resourceName))).status, 200);
        }
        assert.deepEqual(files, [path.join(resourceDirectory, "menu.html"), path.join(resourceDirectory, "menu.js"),
            path.join(resourceDirectory, "menu.css"), controlsPath]);
        assert.equal((await ses.protocols.https(new Request(ORIGIN + "/controls.css?url=private"))).status, 403);
        assert.equal((await ses.protocols.https(new Request(ORIGIN + "/preload.js"))).status, 403);
    } finally { router.destroy(); }
});

test("a missing menu stylesheet closes the session instead of showing partially loaded private UI", async () => {
    const f = setup("asset");
    try {
        f.open(); f.action("ready");
        assert.equal((await f.sessions[0].protocols.https(new Request(ORIGIN + "/menu.css"))).status, 404);
        assert.equal(f.manager.inspect(), undefined);
        assert.equal(f.views[0].webContents.isDestroyed(), true);
        assert.equal(f.sessions[0].cleanup.length, 5);
        assert.equal(f.closed.at(-1).reason, "resource-failed");
        assert.equal(JSON.stringify(f.closed).includes("private path"), false);
    } finally { f.manager.destroy(); }
});

test("overlay pagination gates, permission revocation and owner navigation destroy private state", () => {
    const f = setup();
    try {
        f.open(); f.action("ready"); f.action("more"); f.action("more");
        assert.equal(f.actions.length, 1);
        f.revoke(); f.action("select", {id: "row-1"});
        assert.equal(f.manager.inspect(), undefined);
        assert.equal(f.closed.at(-1).reason, "permission-revoked");
    } finally { f.manager.destroy(); }
    for (const operation of [f => f.owner.emit("did-start-navigation", {isMainFrame: true}),
        f => { f.owner.mainFrame.url = "file:///other.html"; f.action("select", {id: "row-1"}); },
        f => f.owner.emit("destroyed"), f => f.win.emit("closed")]) {
        const fixture = setup();
        fixture.open(); fixture.action("ready"); operation(fixture);
        assert.equal(fixture.manager.inspect(), undefined);
        assert.equal(fixture.views[0].webContents.dead, true);
        assert.equal(fixture.children.length, 0);
        assert.equal(fixture.sessions[0].cleanup.length, 5);
        fixture.manager.destroy();
        assert.equal(fixture.ipcMain.listenerCount(CHANNEL + "-action"), 0);
    }
});

test("overlay anchors use actual zoom/content bounds; geometry is deduplicated and focus transitions do not hide", () => {
    const f = setup();
    try {
        const sessionID = f.open(); f.action("ready");
        const view = f.views[0];
        f.owner.emit("blur");
        assert.ok(f.manager.inspect());
        const count = view.bounds.length;
        f.manager.setAnchor(f.event, {sessionID, anchor});
        assert.equal(view.bounds.length, count);
        f.owner.zoom = 1.25;
        f.manager.setAnchor(f.event, {sessionID, anchor: {...anchor, y: 100}});
        assert.deepEqual(view.bounds.at(-1), place({...anchor, y: 100}, 1.25, f.win.bounds));
        assert.deepEqual(view.visibility, [false, true]);
        f.map.emit("before-mouse-event", {}, {type: "mouseDown"});
        assert.equal(f.manager.inspect(), undefined);
        assert.equal(f.owner.focused, 0);
        f.open(); f.action("ready");
        f.win.bounds = {width: 100, height: 100}; f.win.emit("resize");
        assert.equal(f.manager.inspect(), undefined);
    } finally { f.manager.destroy(); }
});

test("overlay setup failures close sessions, views and listeners transactionally", async () => {
    for (const failure of ["constructor", "attach", "bounds", "load"]) {
        const f = setup(failure);
        f.open();
        await Promise.resolve();
        assert.equal(f.manager.inspect(), undefined, failure);
        assert.equal(f.children.length, 0, failure);
        assert.equal(f.sessions[0].cleanup.length, 5, failure);
        if (f.views[0]) assert.equal(f.views[0].webContents.dead, true, failure);
        f.manager.destroy();
        assert.equal(f.ipcMain.listenerCount(CHANNEL + "-action"), 0, failure);
    }
});

test("manual harness requires an explicit profile and owns only its fresh temporary directory", async () => {
    const {createHarness, createTemporaryProfile} = require("./fixtures/map-unplaced-overlay/harnessSupport.cjs");
    await assert.rejects(createHarness(), /explicit isolated fixture profile/);
    const temporary = createTemporaryProfile();
    try {
        assert.equal(path.dirname(temporary.profile), os.tmpdir());
        assert.ok(path.basename(temporary.profile).startsWith("siyuan-unplaced-manual-"));
        fs.writeFileSync(path.join(temporary.profile, "fixture-only"), "synthetic");
    } finally { temporary.cleanup(); }
    assert.equal(fs.existsSync(temporary.profile), false);
    temporary.cleanup();
});

test("actual preload exposes only fixed operations, binds session/revision and never forwards IPC events", () => {
    const ipc = new EventEmitter(), sent = [];
    ipc.send = (channel, value) => sent.push({channel, value});
    let bridge;
    vm.runInNewContext(fs.readFileSync(path.join(resourceDirectory, "preload.js"), "utf8"), {
        require: name => { assert.equal(name, "electron"); return {ipcRenderer: ipc,
            contextBridge: {exposeInMainWorld(name, value) { assert.equal(name, "unplacedMenu"); bridge = value; }}}; },
        process: {argv: ["--unplaced-session=" + "a".repeat(48)]},
    });
    assert.deepEqual(Object.keys(bridge).sort(), ["close", "editing", "more", "previous", "resize", "retry", "search", "select", "subscribe"]);
    const updates = [], themes = [];
    bridge.subscribe((...args) => updates.push(args), (...args) => themes.push(args));
    assert.equal(sent[0].value.type, "ready");
    const privateEvent = {sender: "must-not-pass"};
    ipc.emit(CHANNEL + "-state", privateEvent, {sessionID: "b".repeat(48), state: state()});
    assert.equal(updates.length, 0);
    ipc.emit(CHANNEL + "-state", privateEvent, {sessionID: "a".repeat(48), state: state({revision: 3})});
    assert.equal(updates[0].length, 1);
    assert.equal(updates[0][0].revision, 3);
    ipc.emit(CHANNEL + "-theme", privateEvent, {sessionID: "a".repeat(48), theme: {mode: "dark", fontSize: 32}});
    assert.equal(themes.length, 1);
    assert.equal(themes[0].length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(themes[0][0])), {mode: "dark", fontSize: 32});
    assert.equal(updates.length, 1, "theme must not replay a stale result state");
    bridge.select("row-1");
    assert.equal(sent.at(-1).value.revision, 3);
    assert.equal(sent.at(-1).value.sessionID, "a".repeat(48));
    const count = sent.length;
    bridge.close("url"); bridge.search("x".repeat(257));
    for (const height of [0, 49, 4097, 50.5, NaN, Infinity, "200"]) bridge.resize(height);
    assert.equal(sent.length, count);
    bridge.resize(220);
    assert.equal(sent.at(-1).value.type, "resize");
    assert.equal(sent.at(-1).value.height, 220);
    assert.equal(sent.at(-1).value.revision, 3);
});

test("actual menu script uses text nodes, preserves pending edits against late states and suppresses composing search (simulated DOM)", () => {
    const {DOMFixture} = require("../src/protyle/render/av/map/testDOM.ts");
    const document = new DOMFixture();
    document.body.innerHTML = fs.readFileSync(path.join(resourceDirectory, "menu.html"), "utf8");
    document.getElementById = id => document.body.querySelector('[id="' + id + '"]');
    document.addEventListener = (...args) => document.documentElement.addEventListener(...args);
    document.createElementNS = (_namespace, name) => document.createElement(name);
    const menu = document.getElementById("menu");
    let preferredHeight = 180, observed, disconnected = false;
    menu.getBoundingClientRect = () => ({height: menu.classList.contains("map-unplaced-menu--measure") ? preferredHeight : 120});
    const rows = document.getElementById("rows");
    rows.replaceChildren = () => { Array.from(rows.children).forEach(child => child.remove()); };
    const actions = [], timers = new Map();
    let update, themeUpdate, nextTimer = 0;
    const bridge = {subscribe(fn, onTheme) { update = fn; themeUpdate = onTheme; }};
    const sizes = [], windowEvents = new Map();
    for (const name of ["search", "editing", "more", "previous", "retry", "select", "close"]) bridge[name] = value => actions.push([name, value]);
    bridge.resize = value => sizes.push(value);
    const window = {unplacedMenu: bridge, addEventListener(name, callback) { windowEvents.set(name, callback); }};
    vm.runInNewContext(fs.readFileSync(path.join(resourceDirectory, "menu.js"), "utf8"), {window, document,
        ResizeObserver: function (callback) { observed = callback; this.observe = target => assert.equal(target, menu);
            this.disconnect = () => { disconnected = true; }; },
        setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); }});
    const flush = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); };
    const fire = (element, type, event = {}) => (element.events.get(type) || []).forEach(fn => fn({preventDefault() {}, ...event}));
    update(state());
    assert.equal(rows.children.length, 1);
    assert.equal(rows.querySelectorAll("img").length, 0);
    assert.equal(rows.children[0].textContent, "Private <img src=x>");
    assert.deepEqual(rows.querySelectorAll("use").map(icon => icon.getAttribute("href")), ["#iconFile", "#iconOpen"]);
    assert.ok(rows.children[0].classList.contains("av-records-panel-item"));
    assert.ok(document.getElementById("count").classList.contains("counter--bg"));
    assert.equal(document.getElementById("count").textContent, "123");
    assert.equal(document.getElementById("status").hidden, true);
    assert.deepEqual(sizes, [228]);
    assert.equal(menu.classList.contains("map-unplaced-menu--measure"), false);
    observed();
    assert.deepEqual(sizes, [228], "viewport resize must not create a shrinking feedback loop");
    update(state({revision: 2}));
    assert.deepEqual(sizes, [228, 228], "a new state revision retries the same height after a stale resize");
    preferredHeight = 240;
    observed();
    assert.equal(sizes.at(-1), 288);
    const input = document.getElementById("search");
    fire(document.getElementById("more"), "click");
    assert.equal(rows.children[0].disabled, true);
    themeUpdate({mode: "dark", fontSize: 32});
    assert.equal(document.documentElement.dataset.fontSize, "32");
    assert.equal(rows.children[0].disabled, true, "theme during pagination cannot restore previous-page members");
    assert.equal(document.getElementById("more").disabled, true);
    update(state());
    input.value = ""; fire(input, "input"); flush();
    assert.deepEqual(actions.at(-1), ["search", ""]);
    themeUpdate({mode: "light", fontSize: 16});
    assert.equal(rows.children[0].disabled, true, "theme after same-query search cannot replay the preceding result");
    update(state());
    input.value = "new"; fire(input, "input");
    assert.equal(actions.at(-1)[0], "editing");
    update(state({revision: 2}));
    assert.equal(rows.children[0].disabled, true);
    flush();
    assert.deepEqual(actions.at(-1), ["search", "new"]);
    update(state({revision: 3, query: "old"}));
    assert.equal(rows.children[0].disabled, true);
    update(state({revision: 4, query: "new"}));
    assert.equal(rows.children[0].disabled, false);
    fire(input, "compositionstart"); input.value = "中文"; fire(input, "input", {isComposing: true}); flush();
    assert.equal(actions.at(-1)[0], "editing");
    update(state({revision: 5, query: "new", theme: {mode: "dark", fontSize: 32}}));
    assert.equal(rows.children[0].disabled, true);
    assert.equal(document.documentElement.dataset.theme, "dark");
    assert.equal(document.documentElement.dataset.fontSize, "32");
    fire(input, "compositionend"); flush();
    assert.deepEqual(actions.at(-1), ["search", "中文"]);
    update(state({revision: 6, query: "中文", theme: {mode: "dark", fontSize: 24}}));
    assert.equal(document.documentElement.dataset.theme, "dark");
    assert.equal(document.documentElement.dataset.fontSize, "24");
    fire(document.documentElement, "keydown", {key: "Escape"});
    assert.deepEqual(actions.at(-1), ["close", "escape"]);
    const actionCount = actions.length;
    fire(document.documentElement, "pointerdown", {target: input});
    assert.equal(actions.length, actionCount);
    fire(document.documentElement, "pointerdown", {target: document.body});
    assert.deepEqual(actions.at(-1), ["close", "button"]);
    fire(document.getElementById("close"), "click");
    assert.deepEqual(actions.at(-1), ["close", "button"]);
    windowEvents.get("pagehide")();
    assert.equal(disconnected, true);
});

test("actual owner script keeps toggle/outside separate and cancels stale same-query work (simulated DOM)", async () => {
    const {DOMFixture} = require("../src/protyle/render/av/map/testDOM.ts");
    const document = new DOMFixture();
    document.body.innerHTML = fs.readFileSync(path.join(fixtureDirectory, "owner.html"), "utf8");
    document.getElementById = id => document.body.querySelector('[id="' + id + '"]');
    document.addEventListener = (...args) => document.documentElement.addEventListener(...args);
    const toggle = document.getElementById("open");
    toggle.getBoundingClientRect = () => ({x: 100, y: 50, left: 100, top: 50, right: 260, bottom: 80, width: 160, height: 30});
    const viewport = {left: 0, top: 20, right: 600, bottom: 420};
    document.getElementById("scroll").getBoundingClientRect = () => viewport;
    const sessionID = "a".repeat(48), updates = [], closes = [], anchors = [], timers = new Map(), listeners = new Map();
    let reply, opens = 0, nextTimer = 0;
    const bridge = {
        async open(value) { opens++; assert.ok(parseState(value.state)); return sessionID; },
        update(value) { assert.ok(parseState(value.state)); updates.push(value); },
        close(value) { closes.push(value); },
        subscribe(fn) { reply = fn; }, anchor(value) { anchors.push(value); }, zoom() {}, permission() {},
    };
    vm.runInNewContext(fs.readFileSync(path.join(fixtureDirectory, "owner.js"), "utf8"), {
        window: {fixtureOwner: bridge, innerWidth: 800, innerHeight: 600,
            addEventListener(name, fn) { listeners.set(name, fn); }}, document,
        setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); },
    });
    const click = () => toggle.events.get("click")[0]();
    const pointer = target => document.documentElement.events.get("pointerdown")[0]({target});
    await click();
    assert.equal(opens, 1);
    pointer(toggle);
    assert.equal(closes.length, 0);
    await click();
    assert.equal(opens, 1);
    assert.equal(closes.at(-1).reason, "button");
    reply({type: "closed", sessionID, reason: "button", restore: true});
    await click();
    assert.equal(opens, 2);
    viewport.top = 60;
    listeners.get("scroll")();
    assert.deepEqual(JSON.parse(JSON.stringify(anchors.at(-1).anchor)), {x: 100, y: 60, width: 160, height: 20});
    viewport.top = 90;
    listeners.get("scroll")();
    assert.equal(closes.at(-1).reason, "anchor-hidden");
    viewport.top = 20;
    pointer(document.body);
    assert.equal(closes.at(-1).reason, "outside");
    const query = "合成记录 1";
    reply({type: "search", sessionID, requestID: 1, query, page: 1});
    const lateA = [...timers.values()][0];
    reply({type: "editing", sessionID, requestID: 2});
    reply({type: "search", sessionID, requestID: 3, query: "合成记录 2", page: 1});
    reply({type: "editing", sessionID, requestID: 4});
    reply({type: "search", sessionID, requestID: 5, query, page: 1});
    const count = updates.length;
    lateA();
    assert.equal(updates.length, count);
    [...timers.values()][0]();
    assert.equal(updates.at(-1).state.requestID, 5);
    assert.equal(updates.at(-1).state.loading, false);
    assert.equal(updates.at(-1).state.total, 34);
    reply({type: "closed", sessionID, reason: "outside", restore: false});
    assert.equal(timers.size, 0);
});

test("trusted menu content sizing stays bounded and rejects stale or foreign renderer requests", () => {
    const f = setup();
    try {
        f.open(); f.action("ready");
        const view = f.views[0];
        assert.equal(view.background, "#00000000");
        f.action("resize", {height: 220});
        assert.equal(view.bounds.at(-1).height, 220);
        const count = view.bounds.length;
        f.action("resize", {height: 220});
        assert.equal(view.bounds.length, count, "same content size never moves or flashes the view");
        for (const height of [0, 49, 4097, 100.5, NaN, Infinity]) {
            f.action("resize", {height});
            assert.equal(view.bounds.length, count);
        }
        f.action("resize", {height: 250, revision: 0});
        f.action("resize", {height: 250, sessionID: "f".repeat(48)});
        f.action("resize", {height: 250}, {sender: f.owner, senderFrame: f.owner.mainFrame});
        assert.equal(view.bounds.length, count);
        f.action("resize", {height: 4096});
        const bounds = view.bounds.at(-1);
        assert.ok(bounds.height <= Math.floor(f.win.bounds.height * 0.65) + 48);
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= f.win.bounds.width &&
            bounds.y + bounds.height <= f.win.bounds.height);
        assert.deepEqual(view.visibility, [false, true], "resizing content never hides the map/menu");
        assert.equal(f.actions.length, 0, "content size does not become an owner data action");
        f.manager.revoke();
        assert.equal(f.manager.inspect(), undefined);
    } finally { f.manager.destroy(); }
});
