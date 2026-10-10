const assert = require("node:assert/strict");
const {test} = require("node:test");
const {
    mapHostFiles, unsafeMapSwitches, hasUnsafeMapSwitches, normalizeMapOrigin, parseMapCreate, parseMapCommand,
    parseMapReply, isAllowedMapProviderURL, getMapRequestPolicy, createMapContentSecurityPolicy,
} = require("./mapHostPolicy");

const instanceID = "a".repeat(48);
const origin = "http://127.0.0.1:6806";
const envelope = {version: 1, instanceID};

test("map origin accepts only the exact registered HTTP(S) origin", () => {
    assert.equal(normalizeMapOrigin(origin), origin);
    for (const invalid of [origin + "/", origin + "/api", "file:///tmp", "https://user:pass@example.com", "null", undefined]) {
        assert.equal(normalizeMapOrigin(invalid), undefined);
    }
});

test("only fixed local assets are available; another kernel, APIs, methods and path aliases are denied", () => {
    for (const file of Object.keys(mapHostFiles)) {
        const query = file.endsWith("index.html") ? "?provider=openfreemap" : "";
        assert.equal(getMapRequestPolicy(origin + file + query, "GET", origin).type, "local");
    }
    for (const url of [origin + "/api/system/getConf", origin + "/stage/build/app/index.js", origin + "/stage/map/",
        origin + "/stage/map/index.html?provider=amap", origin + "/stage/map/index.html?provider=openfreemap&extra=1",
        origin + "/stage/map/%69ndex.html?provider=openfreemap", origin + "/stage/map/host.css?api=1",
        "http://127.0.0.1:6807/stage/map/host.css", "file:///etc/passwd", "https://evil.example/", "ws://127.0.0.1:6806/ws"]) {
        assert.equal(getMapRequestPolicy(url, "GET", origin), undefined, url);
    }
    assert.equal(getMapRequestPolicy(origin + "/stage/map/host.css", "POST", origin), undefined);
});

test("provider routing rejects other providers, insecure schemes, ports, credentials and suffix tricks", () => {
    assert.equal(isAllowedMapProviderURL("https://tiles.openfreemap.org/planet/a"), true);
    for (const url of ["http://tiles.openfreemap.org/a", "https://tiles.openfreemap.org:444/a",
        "https://key:secret@tiles.openfreemap.org/a", "https://tiles.openfreemap.org.evil.example/a",
        "https://eviltiles.openfreemap.org/a", "https://tiles.openfreemap.org./a", "https://tiles.openfreemap.org/a#fragment",
        "https://webapi.amap.com/maps", "https://webrd01.is.autonavi.com/a", "https://map.qq.com/",
        "https://api.map.baidu.com/", "https://127.0.0.1/api", "data:text/plain,a", "file:///tmp/a"]) {
        assert.equal(isAllowedMapProviderURL(url), false, url);
    }
});

test("only OpenFreeMap initializes and credentials, metadata and commands cannot cross the whitelist", () => {
    const init = parseMapCreate({...envelope, provider: "openfreemap", theme: "dark", credentials: {
        apiKey: " key ", securityCode: " code ", userToken: "never", url: origin,
    }, executeJavaScript: "never"});
    assert.deepEqual(init, {...envelope, type: "init", provider: "openfreemap", theme: "dark"});
    for (const provider of ["amap", "tencent", "baidu", "evil", "__proto__", undefined]) {
        assert.equal(parseMapCreate({...envelope, provider, theme: "light"}), undefined);
    }
    const point = {id: "row-1", longitude: 120, latitude: 30, title: "private", content: "private"};
    const command = parseMapCommand({...envelope, type: "setPoints", revision: 1, points: [point, point,
        {...point, id: "bad-lat", latitude: 90}, {...point, id: "bad-lon", longitude: 181}]}, instanceID);
    assert.deepEqual(command.points, [{id: "row-1", longitude: 120, latitude: 30}]);
    assert.equal(parseMapCommand({...envelope, type: "init"}, instanceID), undefined);
    assert.equal(parseMapCommand({...envelope, type: "navigate", url: "https://example.com"}, instanceID), undefined);
    assert.equal(parseMapCommand({...envelope, type: "setPoints", revision: -1, points: []}, instanceID), undefined);
    assert.equal(parseMapReply({...envelope, type: "error", code: "readFile"}, instanceID), undefined);
    assert.deepEqual(parseMapReply({...envelope, type: "bootstrapReady", url: "bad"}, instanceID), {...envelope, type: "bootstrapReady"});
});

test("obsolete coordinate-system point messages are rejected rather than reinterpreted", () => {
    for (const coordinateSystem of ["wgs84", "gcj02", "bd09", "unknown", "", undefined]) {
        const points = [{id: "row", longitude: 120, latitude: 30, coordinateSystem}];
        assert.deepEqual(parseMapCommand({...envelope, type: "setPoints", revision: 0, points}, instanceID).points, []);
    }
});

test("map visibility accepts only its exact envelope and copies a bounded viewport", () => {
    for (const visible of [true, false]) {
        const value = {...envelope, type: "visibility", visible};
        assert.deepEqual(parseMapCommand(value, instanceID), value);
    }
    for (const viewport of [{x: 0, y: 0, width: 1, height: 1},
        {x: 32768, y: 32768, width: 32768, height: 32768},
        {x: 10.25, y: 20.5, width: 0.25, height: 0.5}]) {
        const value = {...envelope, type: "visibility", visible: true, viewport};
        const command = parseMapCommand(value, instanceID);
        assert.deepEqual(command, value);
        assert.notEqual(command, value);
        assert.notEqual(command.viewport, viewport);
    }
});

test("map visibility rejects foreign envelopes, extra fields and non-boolean visibility", () => {
    const value = {...envelope, type: "visibility", visible: true};
    for (const visible of [undefined, null, 0, 1, "true", "false", {}, []]) {
        assert.equal(parseMapCommand({...value, visible}, instanceID), undefined);
    }
    for (const extra of [{url: origin}, {executeJavaScript: "never"}, {bounds: {}}, {visibleToOwner: true},
        {privateData: undefined}]) {
        assert.equal(parseMapCommand({...value, ...extra}, instanceID), undefined);
    }
    assert.equal(parseMapCommand({...value, version: 2}, instanceID), undefined);
    assert.equal(parseMapCommand(value, "b".repeat(48)), undefined);
    const missingVisibility = {...value};
    delete missingVisibility.visible;
    assert.equal(parseMapCommand(missingVisibility, instanceID), undefined);
});

test("map visibility rejects malformed viewport values and fields instead of discarding them", () => {
    const value = {...envelope, type: "visibility", visible: true};
    const viewport = {x: 0, y: 0, width: 200, height: 100};
    for (const invalid of [null, undefined, [], "viewport", 1, {}, {...viewport, extra: true},
        {...viewport, crop: undefined}]) {
        assert.equal(parseMapCommand({...value, viewport: invalid}, instanceID), undefined);
    }
    for (const key of ["x", "y", "width", "height"]) {
        const incomplete = {...viewport};
        delete incomplete[key];
        assert.equal(parseMapCommand({...value, viewport: incomplete}, instanceID), undefined, key);
        for (const number of [undefined, null, NaN, Infinity, -Infinity, -1, 32769, "1", true]) {
            assert.equal(parseMapCommand({...value, viewport: {...viewport, [key]: number}}, instanceID), undefined,
                key + ": " + String(number));
        }
    }
    for (const key of ["width", "height"]) {
        assert.equal(parseMapCommand({...value, viewport: {...viewport, [key]: 0}}, instanceID), undefined, key);
    }
    for (const hiddenViewport of [viewport, null, undefined]) {
        assert.equal(parseMapCommand({...value, visible: false, viewport: hiddenViewport}, instanceID), undefined);
    }
});

test("guest replies cannot dismiss the owner's menu", () => {
    for (const extra of [{}, {id: "row-1", revision: 1}, {trusted: true}, {visible: false}]) {
        assert.equal(parseMapReply({...envelope, type: "dismissMenu", ...extra}, instanceID), undefined);
    }
});

test("WGS84 points keep finite world bounds, the Mercator latitude limit and the point count limit", () => {
    const points = Array.from({length: 10010}, (_, index) => ({id: "row-" + index, longitude: 10, latitude: 20}));
    assert.equal(parseMapCommand({...envelope, type: "setPoints", revision: 0, points}, instanceID).points.length, 10000);
    const limit = 85.0511287798066;
    const bounds = [{id: "west", longitude: -180, latitude: -limit}, {id: "east", longitude: 180, latitude: limit}];
    for (const [longitude, latitude] of [[-181, 0], [181, 0], [0, -limit - 1e-10], [0, limit + 1e-10],
        [0, -90], [0, 90], [NaN, 0], [0, NaN], [Infinity, 0], [0, -Infinity], ["10", 20]]) {
        bounds.push({id: "invalid-" + bounds.length, longitude, latitude});
    }
    assert.deepEqual(parseMapCommand({...envelope, type: "setPoints", revision: 0, points: bounds}, instanceID).points,
        bounds.slice(0, 2));
});

test("map loading failures retain only fixed stage codes across the desktop boundary", () => {
    for (const code of ["sdkScriptLoadFailed", "sdkGlobalMissing", "mapCreationFailed", "mapReadyTimeout"]) {
        assert.deepEqual(parseMapReply({...envelope, type: "error", code, message: "https://private.invalid/?key=secret",
            stack: "secret"}, instanceID), {...envelope, type: "error", code});
    }
    assert.equal(parseMapReply({...envelope, type: "error", code: "https://private.invalid/?key=secret"}, instanceID), undefined);
});

test("host failure replies preserve fixed reasons and reject invented or foreign failure codes", () => {
    for (const code of ["hostLimitReached", "hostSetupFailed", "hostAttachFailed", "hostDocumentLoadFailed",
        "hostDocumentLoadTimeout", "hostDocumentReloaded", "hostDocumentMismatch", "hostRendererGone", "hostDestroyed",
        "hostPortSetupFailed", "hostPortClosed", "hostBootstrapFailed", "hostBootstrapTimeout", "hostSDKTimeout",
        "hostOperationFailed", "hostCreateRejected", "hostCreateInvalidResponse", "hostReadyTimeout", "hostOwnerSetupFailed"]) {
        const reply = {...envelope, type: "error", code};
        assert.deepEqual(parseMapReply({...reply, error: "private", url: "https://private.invalid/?key=secret"}, instanceID), reply);
        assert.equal(parseMapReply(reply, "other"), undefined);
        assert.equal(parseMapReply({...reply, version: 2}, instanceID), undefined);
    }
    for (const code of ["missingCredentials", "sdkCallbackTimeout", "hostSecret", "hostLimitReached\nprivate",
        "https://private.invalid/?key=secret", null, {}]) {
        assert.equal(parseMapReply({...envelope, type: "error", code}, instanceID), undefined);
    }
});

test("map creation fails closed for effective process security bypasses", () => {
    const commandLine = switches => ({hasSwitch: name => switches.has(name), getSwitchValue: name => switches.get(name)});
    assert.equal(hasUnsafeMapSwitches(commandLine(new Map())), false);
    assert.equal(hasUnsafeMapSwitches(commandLine(new Map([["allow-file-access-from-files", ""]]))), false);
    for (const name of unsafeMapSwitches) assert.equal(hasUnsafeMapSwitches(commandLine(new Map([[name, ""]]))), true, name);
    for (const value of ["IsolateOrigins", "Other, SitePerProcess", "OutOfBlinkCors:trial", "SitePerProcess<Experiment"]) {
        assert.equal(hasUnsafeMapSwitches(commandLine(new Map([["disable-features", value]]))), true);
    }
    assert.equal(hasUnsafeMapSwitches(commandLine(new Map([["disable-features", "AutoupgradeMixedContent"]]))), false);
});

test("bootstrap CSP has sandbox isolation and only fixed local assets plus OpenFreeMap", () => {
    const csp = createMapContentSecurityPolicy(origin);
    assert.match(csp, /sandbox allow-scripts;/);
    assert.match(csp, /frame-src 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.ok(!csp.includes("allow-same-origin"));
    assert.ok(!csp.includes("unsafe-eval"));
    assert.doesNotMatch(csp, /amap|autonavi|qq\.com|baidu|bdimg|alicdn|taobao/);
    assert.throws(() => createMapContentSecurityPolicy("http://example.com/a"));
});

test("OpenFreeMap CSP scopes bundled scripts, worker, styles and tile requests to their exact sources", () => {
    const csp = createMapContentSecurityPolicy(origin);
    const directives = Object.fromEntries(csp.split(";").filter(value => value.trim()).map(value => {
        const [name, ...sources] = value.trim().split(/\s+/);
        return [name, sources];
    }));
    assert.deepEqual(directives["script-src"], [origin + "/stage/build/map/host.js", origin + "/stage/build/map/maplibre-gl.js"]);
    assert.deepEqual(directives["worker-src"], ["blob:"]);
    assert.deepEqual(directives["connect-src"], ["https://tiles.openfreemap.org", origin + "/stage/build/map/maplibre-gl-csp-worker.js"]);
    assert.deepEqual(directives["img-src"], ["data:", "blob:", "https://tiles.openfreemap.org"]);
    assert.deepEqual(directives["style-src"], ["'unsafe-inline'", origin + "/stage/map/host.css", origin + "/stage/build/map/maplibre-gl.css"]);
    assert.deepEqual(directives["frame-src"], ["'none'"]);
    assert.deepEqual(directives.sandbox, ["allow-scripts"]);
    assert.equal(getMapRequestPolicy("https://tiles.openfreemap.org/resource", "GET", origin).type, "provider");
});
