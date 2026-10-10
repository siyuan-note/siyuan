const assert = require("node:assert/strict");
const {test} = require("node:test");
const {MAX_MAP_DIAGNOSTICS, mapDiagnosticCodes, mapCSPDiagnosticCodes, mapCSPResourceCodes, isMapCSPResource, classifyMapConsoleMessage,
    classifyMapCSPResources} = require("./mapHostDiagnostics");

test("provider console diagnostics return fixed categories without SDK text, URL or credentials", () => {
    const cases = [
        ["Refused blob:https://secret.invalid/key to worker because it violates Content Security Policy worker-src 'none'", ["cspWorker"]],
        ["Refused eval because Content Security Policy script-src does not allow unsafe-eval; key=private", ["cspScript", "cspEval"]],
        ["SecurityError: Access to localStorage is denied for https://secret.invalid", ["storageUnavailable"]],
        ["WebGL initialization failed", ["webglUnavailable"]],
        ["INVALID_USER_SCODE credential=private", []],
        ["INVALID_USER_KEY INVALID_USER_DOMAIN USERKEY_PLAT_NOMATCH", []],
        ["arbitrary provider text with key=private", []],
        [undefined, []],
    ];
    for (const [message, expected] of cases) {
        const result = classifyMapConsoleMessage(message);
        assert.deepEqual(result, expected);
        assert.ok(result.every(code => mapDiagnosticCodes.includes(code)));
    }
});

test("Chromium CSP messages identify bounded resources and the fixed public tile hostname without retaining their URLs", () => {
    // Chromium 152 的三类资源拒绝文案，以及旧式 Refused to 文案。
    const cases = [
        ["Loading the script 'https://tiles.openfreemap.org/private.js?key=secret' violates the following Content Security Policy directive: \"script-src https://tiles.openfreemap.org\". The action has been blocked.", "cspScript", "https:tiles.openfreemap.org"],
        ["Connecting to 'https://tiles.openfreemap.org/rp?secret=private' violates the following Content Security Policy directive: \"connect-src https://tiles.openfreemap.org\".", "cspConnect", "https:tiles.openfreemap.org"],
        ["Creating a worker from 'blob:null/private-token' violates the following Content Security Policy directive: \"worker-src 'none'\".", "cspWorker", "blob"],
        ["Refused to create a worker from 'data:text/javascript,private' because it violates the following Content Security Policy directive: \"worker-src 'none'\".", "cspWorker", "data"],
        ["Refused to load the script 'https://private@tiles.openfreemap.org/log?key=secret' because it violates the following Content Security Policy directive: \"script-src https://tiles.openfreemap.org\".", "cspScript", "redacted"],
        ["Refused to connect to 'http://tiles.openfreemap.org/private' because it violates the following Content Security Policy directive: \"connect-src https://tiles.openfreemap.org\".", "cspConnect", "http:tiles.openfreemap.org"],
        ["Loading the image 'http://tiles.openfreemap.org/private' violates the following Content Security Policy directive: \"img-src https://tiles.openfreemap.org\".", "cspImage", "http:tiles.openfreemap.org"],
        ["Loading the stylesheet 'https://tiles.openfreemap.org/private?key=secret' violates the following Content Security Policy directive: \"style-src 'none'\".", "cspStyle", "https:tiles.openfreemap.org"],
        ["Executing inline script violates the following Content Security Policy directive 'script-src https://tiles.openfreemap.org'. Either the 'unsafe-inline' keyword, a hash, or a nonce is required.", "cspScript", "inline"],
        ["Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: \"script-src https://tiles.openfreemap.org\".", "cspEval", "eval"],
        ["Compiling or instantiating a WebAssembly module violates the following Content Security policy directive because 'unsafe-eval' is not an allowed source of script: \"script-src https://tiles.openfreemap.org\".", "cspWasm", "wasm"],
        ["Applying inline style violates the following Content Security Policy directive 'style-src-attr https://tiles.openfreemap.org'.", "cspStyle", "inline"],
    ];
    for (const [message, code, resource] of cases) {
        const result = classifyMapCSPResources(message);
        assert.deepEqual(result, [{code, resource}]);
        assert.ok(result.every(item => mapCSPDiagnosticCodes.includes(item.code) && isMapCSPResource(item.resource)));
        assert.doesNotMatch(JSON.stringify(result), /secret|private|token|\/\/|\?/);
    }
});

test("unknown or malformed CSP resources stay bounded and URL contents cannot become diagnostic data", () => {
    for (const [url, resource] of [["https://tiles.openfreemap.org.evil.invalid/path?key=secret", "redacted"],
        ["https://tiles.openfreemap.org:8443/private", "https:tiles.openfreemap.org"],
        ["http://unknown.invalid/unsafe-eval?blob:secret", "redacted"], ["file:///secret", "other"],
        ["not a URL private", "other"], ["blob:https://private.invalid/secret", "blob"]]) {
        const result = classifyMapCSPResources(`Loading the script '${url}' violates the following Content Security Policy directive: "script-src https://tiles.openfreemap.org".`);
        assert.deepEqual(result, [{code: "cspScript", resource}]);
    }
    for (const message of [undefined, {}, "provider secret text", "Content Security Policy unknown directive private",
        "Loading the script 'https://private.invalid' violates a made-up directive",
        "Loading the script 'https://tiles.openfreemap.org/" + "private".repeat(5000) + "' violates Content Security Policy directive: \"script-src 'none'\"."]) {
        assert.deepEqual(classifyMapCSPResources(message), []);
    }
});

test("owner and other local addresses become fixed labels without disclosing names, ports, or credentials", () => {
    const origin = "https://127.0.0.1:6806";
    for (const [target, resource] of [
        [origin + "/private?key=secret", "owner-origin"],
        ["https://127.0.0.1:6807/private", "local-address"],
        ["http://127.0.0.1:6806/private", "local-address"],
        ["https://localhost:6806/private", "local-address"],
        ["https://machine.local/private", "local-address"],
        ["https://machine.internal/private", "local-address"],
        ["https://intranet/private", "local-address"],
        ["https://[::1]:6806/private", "local-address"],
        ["https://192.0.2.1/private", "local-address"],
        ["https://name:secret@127.0.0.1:6806/private", "redacted"],
    ]) {
        const result = classifyMapCSPResources(`Connecting to '${target}' violates the following Content Security Policy directive: "connect-src 'none'".`, origin);
        assert.deepEqual(result, [{code: "cspConnect", resource}]);
        assert.doesNotMatch(JSON.stringify(result), /127|6806|6807|machine|private|secret|localhost|intranet|192/);
    }
    const result = classifyMapCSPResources("Connecting to 'https://notes.example:7443/private' violates the following Content Security Policy directive: \"connect-src 'none'\".", "https://notes.example:7443");
    assert.deepEqual(result, [{code: "cspConnect", resource: "owner-origin"}]);
});

test("resource validator accepts only fixed codes or the exact public tile hostname", () => {
    for (const resource of [...mapCSPResourceCodes, "https:tiles.openfreemap.org", "http:tiles.openfreemap.org"]) {
        assert.equal(isMapCSPResource(resource), true, resource);
    }
    for (const resource of [undefined, null, {}, ["blob"], "https://tiles.openfreemap.org", "https:tiles.openfreemap.org:8443",
        "https:tiles.openfreemap.org/private", "https:tiles.openfreemap.org?key=secret", "https:tiles.openfreemap.org#secret",
        "https:secret@tiles.openfreemap.org", "https:tiles.openfreemap.org.evil.invalid", "https:sub.tiles.openfreemap.org",
        "https:unknown.example", "https:127.0.0.1", "https:[::1]", "https:machine.local", "https:localhost",
        "HTTPS:tiles.openfreemap.org", "https:TILES.openfreemap.org", "https:tiles.openfreemap.org.",
        "https:" + "a".repeat(100) + ".openfreemap.org"]) {
        assert.equal(isMapCSPResource(resource), false, String(resource));
    }
    assert.equal(MAX_MAP_DIAGNOSTICS, 64);
});

test("other providers and unapproved tile subdomains are redacted while blocked directives survive", () => {
    for (const host of ["unknown.example", "webapi.amap.com", "jsapi.amap.com", "webst02.is.autonavi.com",
        "g.alicdn.com", "fourier.taobao.com", "map.qq.com", "api.map.baidu.com", "tiles.openfreemap.org.evil.example",
        "sub.tiles.openfreemap.org", "tiles.openfreemap.org.", "a".repeat(100) + ".openfreemap.org"]) {
        const message = `Loading the script 'https://${host}/private?key=secret' violates the following Content Security Policy directive: "script-src https://tiles.openfreemap.org".`;
        assert.deepEqual(classifyMapCSPResources(message), [{code: "cspScript", resource: "redacted"}]);
        assert.equal(isMapCSPResource("https:" + host), false);
    }
});
