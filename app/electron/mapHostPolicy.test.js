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
        assert.equal(getMapRequestPolicy(origin + file + query, "GET", origin, "openfreemap").type, "local");
    }
    for (const url of [origin + "/api/system/getConf", origin + "/stage/build/app/index.js", origin + "/stage/map/",
        origin + "/stage/map/index.html?provider=amap", origin + "/stage/map/index.html?provider=openfreemap&extra=1",
        origin + "/stage/map/%69ndex.html?provider=openfreemap", origin + "/stage/map/host.css?api=1",
        "http://127.0.0.1:6807/stage/map/host.css", "file:///etc/passwd", "https://evil.example/", "ws://127.0.0.1:6806/ws"]) {
        assert.equal(getMapRequestPolicy(url, "GET", origin, "openfreemap"), undefined, url);
    }
    assert.equal(getMapRequestPolicy(origin + "/stage/map/host.css", "POST", origin, "openfreemap"), undefined);
});

test("provider routing rejects other providers, insecure schemes, ports, credentials and suffix tricks", () => {
    assert.equal(isAllowedMapProviderURL("https://tiles.openfreemap.org/planet/a", "openfreemap"), true);
    assert.equal(isAllowedMapProviderURL("https://webrd01.is.autonavi.com/a", "amap"), true);
    for (const url of ["http://tiles.openfreemap.org/a", "https://tiles.openfreemap.org:444/a",
        "https://key:secret@tiles.openfreemap.org/a", "https://tiles.openfreemap.org.evil.example/a",
        "https://eviltiles.openfreemap.org/a", "https://tiles.openfreemap.org./a", "https://tiles.openfreemap.org/a#fragment",
        "https://webapi.amap.com/maps", "https://127.0.0.1/api", "data:text/plain,a", "file:///tmp/a"]) {
        assert.equal(isAllowedMapProviderURL(url, "openfreemap"), false, url);
    }
    assert.equal(isAllowedMapProviderURL("https://map.qq.com/", "__proto__"), false);
});

test("credentials, point metadata and commands are bounded whitelist copies", () => {
    const init = parseMapCreate({...envelope, provider: "amap", theme: "dark", credentials: {
        apiKey: " key ", securityCode: " code ", userToken: "never", url: origin,
    }, executeJavaScript: "never"});
    assert.deepEqual(init.credentials, {apiKey: "key", securityCode: "code"});
    assert.equal(init.executeJavaScript, undefined);
    assert.deepEqual(parseMapCreate({...envelope, provider: "openfreemap", theme: "light", credentials: {apiKey: "secret"}}).credentials, {});
    assert.deepEqual(parseMapCreate({...envelope, provider: "tencent", theme: "light", credentials: {apiKey: "a".repeat(4097), securityCode: "never"}}).credentials, {});
    assert.equal(parseMapCreate({...envelope, provider: "evil", theme: "light"}), undefined);
    const point = {id: "row-1", longitude: 120, latitude: 30, coordinateSystem: "wgs84", title: "private", content: "private"};
    const command = parseMapCommand({...envelope, type: "setPoints", revision: 1, points: [point, point,
        {...point, id: "bad-lat", latitude: 90}, {...point, id: "bad-crs", coordinateSystem: "gcj02"}]}, instanceID, "openfreemap");
    assert.deepEqual(command.points, [{id: "row-1", longitude: 120, latitude: 30, coordinateSystem: "wgs84"}]);
    assert.equal(parseMapCommand({...envelope, type: "init"}, instanceID, "amap"), undefined);
    assert.equal(parseMapCommand({...envelope, type: "navigate", url: "https://example.com"}, instanceID, "amap"), undefined);
    assert.equal(parseMapCommand({...envelope, type: "setPoints", revision: -1, points: []}, instanceID, "amap"), undefined);
    assert.equal(parseMapReply({...envelope, type: "error", code: "readFile"}, instanceID), undefined);
    assert.deepEqual(parseMapReply({...envelope, type: "bootstrapReady", url: "bad"}, instanceID), {...envelope, type: "bootstrapReady"});
});

test("point count is bounded and provider coordinate systems remain consistent", () => {
    const points = Array.from({length: 10010}, (_, index) => ({id: "row-" + index, longitude: 10, latitude: 20, coordinateSystem: "bd09"}));
    assert.equal(parseMapCommand({...envelope, type: "setPoints", revision: 0, points}, instanceID, "baidu").points.length, 10000);
    assert.equal(parseMapCommand({...envelope, type: "setPoints", revision: 0, points}, instanceID, "amap").points.length, 0);
});

test("map loading failures retain only fixed stage codes across the desktop boundary", () => {
    for (const code of ["sdkScriptLoadFailed", "sdkCallbackTimeout", "sdkGlobalMissing", "mapCreationFailed", "mapReadyTimeout"]) {
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
    for (const code of ["hostSecret", "hostLimitReached\nprivate", "https://private.invalid/?key=secret", null, {}]) {
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

test("bootstrap CSP has sandbox isolation and only fixed local assets plus the selected provider", () => {
    const csp = createMapContentSecurityPolicy(origin, "openfreemap");
    assert.match(csp, /sandbox allow-scripts;/);
    assert.match(csp, /frame-src 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.ok(!csp.includes("allow-same-origin"));
    assert.ok(!csp.includes("unsafe-eval"));
    assert.ok(!csp.includes("amap.com"));
    assert.throws(() => createMapContentSecurityPolicy("http://example.com/a", "openfreemap"));
});

test("AMap permits only its named REST script and blob workers without expanding network access", () => {
    const csp = createMapContentSecurityPolicy(origin, "amap");
    const directives = Object.fromEntries(csp.split(";").filter(value => value.trim()).map(value => {
        const [name, ...sources] = value.trim().split(/\s+/);
        return [name, sources];
    }));
    assert.deepEqual(directives["script-src"], [origin + "/stage/build/map/host.js", "https://webapi.amap.com", "https://restapi.amap.com"]);
    assert.deepEqual(directives["worker-src"], ["blob:"]);
    assert.deepEqual(directives["connect-src"], ["https://webapi.amap.com", "https://restapi.amap.com", "https://vdata.amap.com"]);
    assert.deepEqual(directives["frame-src"], ["'none'"]);
    assert.deepEqual(directives.sandbox, ["allow-scripts"]);
    for (const value of ["https://unknown.example/a", "http://restapi.amap.com/a", origin + "/api/system/getConf", "file:///tmp/a"]) {
        assert.equal(getMapRequestPolicy(value, "GET", origin, "amap"), undefined);
    }
    for (const provider of ["tencent", "baidu"]) {
        const policy = createMapContentSecurityPolicy(origin, provider);
        assert.match(policy, /worker-src 'none'/);
        assert.ok(!policy.includes("restapi.amap.com"));
    }
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
