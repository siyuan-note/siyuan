const assert = require("node:assert/strict");
const {test} = require("node:test");
const {execFile} = require("node:child_process");
const {promisify} = require("node:util");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {EventEmitter} = require("node:events");
const {ownerPreferences, remoteOwnerPreferences, guestPreferences, createSyntheticFiles, checkRealAssets,
    verifyIsolation, readMapCornerAssets, installRemoteOwnerGuards} =
    require("./fixtures/map-webview-boundary/harnessSupport.cjs");
const {createMapSessionRouter} = require("../electron/mapHostManager");
const {createMapContentSecurityPolicy} = require("../electron/mapHostPolicy");
const {createRemoteDocumentContentSecurityPolicy} = require("../electron/remoteKernel");

test("remote fixture retains web security and rejects subframes and objects with the production navigation policy", () => {
    assert.equal(remoteOwnerPreferences.webviewTag, true);
    assert.equal(remoteOwnerPreferences.webSecurity, true);
    assert.equal(remoteOwnerPreferences.nodeIntegrationInSubFrames, false);
    const owner = new EventEmitter(), evidence = {blockedFramePaths: []};
    let beforeRequest;
    installRemoteOwnerGuards(owner, {webRequest: {onBeforeRequest(callback) { beforeRequest = callback; }}}, evidence);
    for (const [resourceType, expected] of [["mainFrame", false], ["script", false], ["subFrame", true], ["object", true]]) {
        let result;
        beforeRequest({resourceType, url: "https://fixture.invalid/" + resourceType}, value => { result = value; });
        assert.deepEqual(result, {cancel: expected});
    }
    for (const isMainFrame of [true, false]) {
        let prevented = false;
        owner.emit("will-frame-navigate", {isMainFrame, url: "https://fixture.invalid/frame",
            preventDefault() { prevented = true; }});
        assert.equal(prevented, !isMainFrame);
    }
    assert.deepEqual(evidence.blockedFramePaths, ["/subFrame", "/object", "/frame"]);
});

test("remote isolation verification fails if owner security, CSP or pre-reservation denial is missing", async () => {
    const origin = "http://127.0.0.1:1234";
    const html = fs.readFileSync(path.join(__dirname, "fixtures/map-webview-boundary/owner.html"), "utf8");
    const result = {origin: "null", require: "undefined", process: "undefined", ipc: "undefined", bridge: ["version"],
        parentOwner: false, topOwner: false, openerOwner: false, evalBlocked: true};
    const fixture = () => ({origin, kernelMode: "remote",
        owner: {getLastWebPreferences: () => remoteOwnerPreferences, session: {}, getOSProcessId: () => 1},
        guest: {getLastWebPreferences: () => guestPreferences, session: {isPersistent: () => false},
            getOSProcessId: () => 2, executeJavaScript: source => Promise.resolve(source.startsWith("fetch(") ? true : result)},
        evidence: {defaultHeaderCalls: 0, defaultGuestHeaderCalls: 0, guestNetworkRequests: 0, privateRequests: 0,
            ownerDocumentCSP: createRemoteDocumentContentSecurityPolicy(html, origin), frameRequests: 0, rejectedAttachments: 3}});
    await verifyIsolation(fixture());
    for (const weaken of [
        value => { value.owner.getLastWebPreferences = () => ownerPreferences; },
        value => { value.evidence.ownerDocumentCSP = ""; },
        value => { value.evidence.defaultHeaderCalls = 1; },
        value => { value.evidence.frameRequests = 1; },
        value => { value.evidence.rejectedAttachments = 0; },
    ]) {
        const value = fixture();
        weaken(value);
        await assert.rejects(verifyIsolation(value));
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

test("corner fixture compiles production styles and visibility logic without a GUI", () => {
    const assets = readMapCornerAssets();
    assert.match(assets.css, /\.av__map-canvas > webview/);
    assert.match(assets.radius, /^\d+(?:\.\d+)?px$/);
    assert.doesNotThrow(() => new Function("exports", assets.visibility));
});

for (const kernelMode of ["local", "remote"]) {
    test(`real Electron ${kernelMode} webview retains owner policy, clips rounded corners and stays behind DOM menus`, {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
            ? "Real Electron verification requires DISPLAY or WAYLAND_DISPLAY; no unsafe startup fallback is allowed" : false,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const flags = ["--synthetic", "--verify", ...(kernelMode === "remote" ? ["--remote"] : [])];
        const result = await promisify(execFile)(require("electron"), [path.join(__dirname, "fixtures/map-webview-boundary/harness.cjs"),
            ...flags], {env, windowsHide: true, timeout: 90000});
        assert.match(result.stdout, /Map webview prototype verification passed\./);
        if (kernelMode === "remote") assert.match(result.stdout, /Remote map owner policy: PASS\./);
    });
}
