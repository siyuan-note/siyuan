const assert = require("node:assert/strict");
const {test} = require("node:test");
const {
    mapHostFiles, unsafeMapSwitches, hasUnsafeMapSwitches, normalizeMapOrigin, parseMapCreate, parseMapCommand,
    parseMapReply, parseMapGeometry, isAllowedMapProviderURL, getMapRequestPolicy, createMapContentSecurityPolicy,
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

test("native geometry converts CSS to DIP, crops inward, and denies off-window or malformed bounds", () => {
    const value = {visible: true, bounds: {x: 10.2, y: 20, width: 200, height: 100},
        logicalSize: {width: 400, height: 200}, crop: {x: 40, y: 30}};
    const geometry = parseMapGeometry(value, 1.25, {width: 800, height: 600});
    assert.deepEqual(geometry.bounds, {x: 13, y: 25, width: 249, height: 125});
    assert.equal(geometry.logicalSize.width, 400);
    assert.ok(Math.abs(geometry.crop.x - 40.2) < 1e-9);
    assert.equal(parseMapGeometry(value, 0, {width: 800, height: 600}), undefined);
    assert.equal(parseMapGeometry(value, 1.25, {width: 100, height: 100}), undefined);
    assert.equal(parseMapGeometry({...value, crop: {x: 300, y: 0}}, 1, {width: 800, height: 600}), undefined);
    assert.equal(parseMapGeometry({...value, bounds: {...value.bounds, x: NaN}}, 1, {width: 800, height: 600}), undefined);
    assert.deepEqual(parseMapGeometry({visible: false}, 1, {}), {visible: false});
});

test("geometry rejection reports only fixed reasons without weakening validation", () => {
    const value = {visible: true, bounds: {x: 10, y: 20, width: 200, height: 100},
        logicalSize: {width: 400, height: 200}, crop: {x: 0, y: 0}};
    const viewport = {width: 800, height: 600};
    for (const [input, zoom, bounds, reason] of [
        [null, 1, viewport, "geometryInvalid"],
        [value, 0, viewport, "geometryInvalid"],
        [{...value, bounds: {...value.bounds, x: NaN}}, 1, viewport, "geometryInvalid"],
        [{...value, logicalSize: {width: 199.99999999999997, height: 200}}, 1, viewport, "geometryLogicalBounds"],
        [{...value, crop: {x: 300, y: 0}}, 1, viewport, "geometryCropBounds"],
        [value, 1, {width: 100, height: 100}, "geometryWindowBounds"],
        [{...value, bounds: {x: 0.1, y: 0.1, width: 1, height: 1}}, 0.25, viewport, "geometryRoundedEmpty"],
    ]) {
        const reasons = [];
        const result = parseMapGeometry(input, zoom, bounds, code => reasons.push(code));
        assert.ok(!result?.visible);
        assert.deepEqual(reasons, [reason]);
    }
    const reasons = [];
    assert.deepEqual(parseMapGeometry({visible: false}, 1, viewport, code => reasons.push(code)), {visible: false});
    assert.deepEqual(reasons, []);
});
