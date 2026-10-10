const assert = require("node:assert/strict");
const path = require("node:path");
const {test} = require("node:test");
const {
    MAP_WEBVIEW_PREFERENCES, hardenMapWebviewPreferences, isMapWebviewAttachment, getMapWebviewPreferenceMismatch,
} = require("./mapWebviewHost");

const host = {
    entryURL: "http://127.0.0.1:6806/stage/map/index.html?provider=openfreemap",
    partition: "siyuan-map-" + "a".repeat(48),
};
const reportedPreferences = {
    sandbox: true,
    contextIsolation: true,
    webSecurity: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    webviewTag: false,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    disablePopups: true,
    safeDialogs: true,
    disableDialogs: true,
};

test("map webview preferences require sandbox isolation and disable privileged guest features", () => {
    assert.ok(Object.isFrozen(MAP_WEBVIEW_PREFERENCES));
    for (const [key, value] of Object.entries(reportedPreferences)) {
        assert.equal(MAP_WEBVIEW_PREFERENCES[key], value, key);
    }
    for (const key of ["plugins", "navigateOnDragDrop", "devTools", "spellcheck", "backgroundThrottling"]) {
        assert.equal(MAP_WEBVIEW_PREFERENCES[key], false, key);
    }
    assert.equal(MAP_WEBVIEW_PREFERENCES.autoplayPolicy, "user-gesture-required");
});

test("map webview hardening removes renderer preferences and forces the registered session and preload", () => {
    const session = {name: "isolated-map-session"};
    const preferences = {
        ...Object.fromEntries(Object.entries(MAP_WEBVIEW_PREFERENCES).map(([key, value]) => [key, !value])),
        session: {name: "default-session"},
        partition: "persist:private",
        preload: "/tmp/renderer-controlled-preload.js",
        preloadURL: "file:///tmp/renderer-controlled-preload.js",
        additionalArguments: ["--disable-web-security"],
        enableBlinkFeatures: "UnsafeFeature",
        disableBlinkFeatures: "SafeFeature",
        rendererControlled: true,
    };
    hardenMapWebviewPreferences(preferences, session, host.partition);
    assert.deepEqual(preferences, {...MAP_WEBVIEW_PREFERENCES, session, partition: host.partition,
        preload: path.join(__dirname, "mapHostPreload.js")});
    assert.equal(preferences.session, session);
});

test("map webview attachment requires the exact registered entry URL and in-memory partition", () => {
    const params = {src: host.entryURL, partition: host.partition};
    assert.equal(isMapWebviewAttachment(params, host), true);
    for (const invalid of [undefined, null, {}, []]) {
        assert.equal(isMapWebviewAttachment(invalid, host), false);
    }
    for (const src of [undefined, "", host.entryURL + "#fragment", host.entryURL + "&extra=1",
        host.entryURL.replace("index.html", "%69ndex.html"),
        host.entryURL.replace("/stage/map/", "/stage/map/../map/"),
        host.entryURL.replace("6806", "6807"), "https://tiles.openfreemap.org/", "file:///tmp/map.html"]) {
        assert.equal(isMapWebviewAttachment({...params, src}, host), false, String(src));
    }
    for (const partition of [undefined, "", "persist:" + host.partition, "siyuan-map-" + "b".repeat(48)]) {
        assert.equal(isMapWebviewAttachment({...params, partition}, host), false, String(partition));
    }
});

test("map webview read-back requires every reported security preference to retain its exact value", () => {
    for (const [key, value] of Object.entries(reportedPreferences)) {
        const missing = {...reportedPreferences};
        delete missing[key];
        assert.equal(getMapWebviewPreferenceMismatch(missing), key, key + " missing");
        for (const changed of [!value, String(value), undefined, null]) {
            assert.equal(getMapWebviewPreferenceMismatch({...reportedPreferences, [key]: changed}), key,
                key + ": " + String(changed));
        }
    }
    for (const invalid of [undefined, null, {}, []]) {
        assert.ok(getMapWebviewPreferenceMismatch(invalid));
    }
});

test("map webview read-back does not require constructor-only or unreported default preferences", () => {
    assert.equal(getMapWebviewPreferenceMismatch({...reportedPreferences}), undefined);
    assert.equal(getMapWebviewPreferenceMismatch({...reportedPreferences,
        defaultFontFamily: {standard: "Times New Roman"}, javascript: true, images: true}), undefined);
});

test("map webview attachment rejects guest-supplied privilege and navigation attributes", () => {
    const params = {src: host.entryURL, partition: host.partition};
    for (const key of ["preload", "webpreferences", "nodeintegration", "nodeintegrationinsubframes", "disablewebsecurity",
        "allowpopups", "plugins", "blinkfeatures", "disableblinkfeatures", "useragent", "httpreferrer"]) {
        for (const value of [true, "true", "false", "file:///tmp/guest.js", 1]) {
            assert.equal(isMapWebviewAttachment({...params, [key]: value}, host), false, key + ": " + value);
        }
        for (const value of [undefined, false, "", 0]) {
            assert.equal(isMapWebviewAttachment({...params, [key]: value}, host), true, key + ": " + String(value));
        }
    }
});
