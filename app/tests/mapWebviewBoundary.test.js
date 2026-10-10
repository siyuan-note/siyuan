const assert = require("node:assert/strict");
const {test} = require("node:test");
const {execFile} = require("node:child_process");
const {promisify} = require("node:util");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {hardenAttachment, ownerPreferences, guestPreferences, createSyntheticFiles, checkRealAssets, getGuestPreferenceMismatch,
    reportedPreferenceKeys, verifyIsolation} =
    require("./fixtures/map-webview-boundary/harnessSupport.cjs");
const {createMapSessionRouter} = require("../electron/mapHostManager");
const {createMapContentSecurityPolicy} = require("../electron/mapHostPolicy");

const attachCase = () => {
    const owner = {}, session = {};
    const expected = {owner, session, partition: "map-webview-fixture-example", src: "http://127.0.0.1:1234/stage/map/index.html?provider=openfreemap#fixed", used: false};
    const event = {sender: owner, denied: false, preventDefault() { this.denied = true; }};
    return {event, expected, params: {src: expected.src, partition: expected.partition}};
};

test("webview attachment fixes all guest privileges, preload and independent session before creation", () => {
    const {event, expected, params} = attachCase();
    const preferences = {nodeIntegration: true, sandbox: false, contextIsolation: false, webSecurity: false,
        preload: "/untrusted/preload.js", partition: "persist:default", session: {}, additionalArguments: ["--unsafe"]};
    assert.equal(hardenAttachment(event, preferences, params, expected), true);
    assert.equal(event.denied, false);
    assert.equal(expected.used, true);
    for (const [name, value] of Object.entries(guestPreferences)) assert.equal(preferences[name], value, name);
    assert.equal(preferences.session, expected.session);
    assert.equal(preferences.partition, expected.partition);
    assert.equal(preferences.preload, path.resolve(__dirname, "../electron/mapHostPreload.js"));
    assert.equal(Object.hasOwn(preferences, "additionalArguments"), false);
    assert.equal(hardenAttachment(event, {}, params, expected), false, "one admitted guest per fixture owner");
});

test("webview attachment rejects forged owner, source, session and renderer privilege attributes", () => {
    const mutations = [
        item => { item.event.sender = {}; },
        item => { item.params.src = "http://127.0.0.1:1234/api/private"; },
        item => { item.params.partition = "persist:shared"; },
        ...["preload", "webpreferences", "nodeintegration", "nodeintegrationinsubframes", "disablewebsecurity",
            "allowpopups", "plugins", "blinkfeatures", "disableblinkfeatures", "useragent", "httpreferrer"]
            .map(name => item => { item.params[name] = "requested"; }),
    ];
    for (const mutate of mutations) {
        const item = attachCase();
        mutate(item);
        const preferences = {sandbox: false};
        assert.equal(hardenAttachment(item.event, preferences, item.params, item.expected), false);
        assert.equal(item.event.denied, true);
        assert.equal(item.expected.used, false);
        assert.deepEqual(preferences, {sandbox: false});
    }
});

test("guest preference readback checks the Electron 44 subset and rejects every missing or changed boundary value", () => {
    const actual = Object.fromEntries(reportedPreferenceKeys.map(name => [name, guestPreferences[name]]));
    assert.equal(getGuestPreferenceMismatch(actual), undefined);
    assert.equal(Object.hasOwn(actual, "preload"), false);
    for (const name of reportedPreferenceKeys) {
        assert.equal(getGuestPreferenceMismatch({...actual, [name]: !actual[name]}), name);
        const missing = {...actual};
        delete missing[name];
        assert.equal(getGuestPreferenceMismatch(missing), name);
    }
});

test("common isolation checks have a fixed deadline and clear their timer on success, failure and timeout", async t => {
    let fire, delay;
    const timer = {}, cleared = [];
    t.mock.method(global, "setTimeout", (callback, milliseconds) => { fire = callback; delay = milliseconds; return timer; });
    t.mock.method(global, "clearTimeout", value => { cleared.push(value); });
    const result = {origin: "null", require: "undefined", process: "undefined", ipc: "undefined", bridge: ["version"],
        parentOwner: false, topOwner: false, openerOwner: false, evalBlocked: true};
    const harness = inspect => ({origin: "http://127.0.0.1:1234",
        owner: {getLastWebPreferences: () => ownerPreferences, session: {}, getOSProcessId: () => 1},
        guest: {getLastWebPreferences: () => guestPreferences, session: {isPersistent: () => false},
            getOSProcessId: () => 2, executeJavaScript: inspect},
        evidence: {defaultHeaderCalls: 1, defaultGuestHeaderCalls: 0, guestNetworkRequests: 0, privateRequests: 0}});
    await verifyIsolation(harness(source => Promise.resolve(source.startsWith("fetch(") ? true : result)));
    assert.equal(delay, 5000);
    assert.deepEqual(cleared, [timer]);
    await assert.rejects(verifyIsolation(harness(() => Promise.reject(new Error("fixture probe failed")))));
    assert.deepEqual(cleared, [timer, timer]);
    const pending = verifyIsolation(harness(() => new Promise(() => {})));
    const rejected = assert.rejects(pending, {code: "isolationCheckTimeout"});
    assert.equal(delay, 5000);
    fire();
    await rejected;
    assert.deepEqual(cleared, [timer, timer, timer]);
});

test("independent guest router retains exact CSP and denies private resources without using the owner session", async () => {
    const hooks = {}, protocols = {}, permissions = {};
    const ses = {webRequest: {}, protocol: {handle(name, fn) { protocols[name] = fn; }}, on() {},
        allowNTLMCredentialsForDomains() {}, closeAllConnections() {}, clearStorageData() {}, clearAuthCache() {}, clearCache() {}, clearHostResolverCache() {}};
    for (const name of ["onBeforeRequest", "onBeforeSendHeaders", "onHeadersReceived"]) ses.webRequest[name] = fn => { hooks[name] = fn; };
    for (const name of ["setPermissionRequestHandler", "setPermissionCheckHandler", "setDevicePermissionHandler", "setDisplayMediaRequestHandler", "setCertificateVerifyProc"]) {
        ses[name] = fn => { permissions[name] = fn; };
    }
    const origin = "http://127.0.0.1:1234";
    let reads = 0;
    const router = createMapSessionRouter({ses, origin, appDir: path.resolve(__dirname, ".."), readFile: async () => {
        reads++;
        return Buffer.from("<!doctype html><div id=map></div>");
    }});
    try {
        const document = await protocols.http(new Request(origin + "/stage/map/index.html?provider=openfreemap"));
        assert.equal(document.headers.get("Content-Security-Policy"), createMapContentSecurityPolicy(origin));
        assert.match(document.headers.get("Content-Security-Policy"), /sandbox allow-scripts/);
        assert.match(document.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
        let filtered;
        hooks.onHeadersReceived({responseHeaders: {"Content-Security-Policy": ["fixed-policy"], "Set-Cookie": ["private=value"]}}, value => { filtered = value; });
        assert.deepEqual(filtered.responseHeaders, {"Content-Security-Policy": ["fixed-policy"]});
        for (const url of [origin + "/api/private", "https://example.invalid/private", "file:///private"]) {
            const handler = url.startsWith("file:") ? protocols.file : protocols.http;
            assert.equal((await handler(new Request(url))).status, 403);
        }
        assert.equal(reads, 1);
        assert.equal(permissions.setPermissionCheckHandler(), false);
        assert.equal(permissions.setDevicePermissionHandler(), false);
        let allowed;
        permissions.setPermissionRequestHandler({}, "clipboard-read", value => { allowed = value; });
        assert.equal(allowed, false);
    } finally { router.destroy(); }
});

test("synthetic mode bundles the existing runtime while real mode fails explicitly when production assets are absent", () => {
    const files = createSyntheticFiles();
    assert.equal(files.size, 3);
    const runtime = files.get("stage/build/map/host.js").toString();
    assert.match(runtime, /connectAVMapRuntime/);
    assert.match(runtime, /parseAVMapCommand/);
    assert.match(runtime, /getAVMapLockedPolicy/);
    assert.doesNotThrow(() => new Function(runtime));
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-map-missing-assets-"));
    try { assert.throws(() => checkRealAssets(empty), {code: "MAP_FIXTURE_ASSETS_MISSING"}); }
    finally { fs.rmSync(empty, {recursive: true, force: true}); }
});

test("real Electron webview retains isolation and ordinary DOM menus cover its live surface without hide or refit", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
        ? "Real Electron verification requires DISPLAY or WAYLAND_DISPLAY; no unsafe startup fallback is allowed" : false,
}, async () => {
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(require("electron"), [path.join(__dirname, "fixtures/map-webview-boundary/harness.cjs"),
        "--synthetic", "--verify"], {env, windowsHide: true, timeout: 90000});
    assert.match(result.stdout, /Map webview prototype verification passed\./);
});
