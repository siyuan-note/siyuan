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
        ["INVALID_USER_SCODE credential=private", ["amapInvalidSecurityCode"]],
        ["arbitrary provider text with key=private", []],
        [undefined, []],
    ];
    for (const [message, expected] of cases) {
        const result = classifyMapConsoleMessage(message);
        assert.deepEqual(result, expected);
        assert.ok(result.every(code => mapDiagnosticCodes.includes(code)));
    }
});

test("Chromium CSP messages identify bounded resources and public hostnames without retaining their URLs", () => {
    // Chromium 152 的三类资源拒绝文案，以及旧式 Refused to 文案。
    const cases = [
        ["Loading the script 'https://g.alicdn.com/private.js?key=secret' violates the following Content Security Policy directive: \"script-src https://webapi.amap.com\". The action has been blocked.", "cspScript", "https:g.alicdn.com"],
        ["Connecting to 'https://fourier.taobao.com/rp?secret=private' violates the following Content Security Policy directive: \"connect-src https://webapi.amap.com\".", "cspConnect", "https:fourier.taobao.com"],
        ["Creating a worker from 'blob:null/private-token' violates the following Content Security Policy directive: \"worker-src 'none'\".", "cspWorker", "blob"],
        ["Refused to create a worker from 'data:text/javascript,private' because it violates the following Content Security Policy directive: \"worker-src 'none'\".", "cspWorker", "data"],
        ["Refused to load the script 'https://private@restapi.amap.com/log?key=secret' because it violates the following Content Security Policy directive: \"script-src https://webapi.amap.com\".", "cspScript", "redacted"],
        ["Refused to connect to 'http://vdata.amap.com/private' because it violates the following Content Security Policy directive: \"connect-src https://vdata.amap.com\".", "cspConnect", "http:vdata.amap.com"],
        ["Connecting to 'https://webst02.is.autonavi.com/private' violates the following Content Security Policy directive: \"connect-src https://vdata.amap.com\".", "cspConnect", "https:webst02.is.autonavi.com"],
        ["Loading the image 'http://webrd01.is.autonavi.com/private' violates the following Content Security Policy directive: \"img-src https://webapi.amap.com\".", "cspImage", "http:webrd01.is.autonavi.com"],
        ["Connecting to 'https://wprd01.is.autonavi.com/private?key=secret' violates the following Content Security Policy directive: \"connect-src https://vdata.amap.com\".", "cspConnect", "https:wprd01.is.autonavi.com"],
        ["Loading the script 'https://jsapi0.amap.com/private?key=secret' violates the following Content Security Policy directive: \"script-src https://webapi.amap.com\".", "cspScript", "https:jsapi0.amap.com"],
        ["Executing inline script violates the following Content Security Policy directive 'script-src https://webapi.amap.com'. Either the 'unsafe-inline' keyword, a hash, or a nonce is required.", "cspScript", "inline"],
        ["Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: \"script-src https://webapi.amap.com\".", "cspEval", "eval"],
        ["Compiling or instantiating a WebAssembly module violates the following Content Security policy directive because 'unsafe-eval' is not an allowed source of script: \"script-src https://webapi.amap.com\".", "cspWasm", "wasm"],
        ["Applying inline style violates the following Content Security Policy directive 'style-src-attr https://webapi.amap.com'.", "cspStyle", "inline"],
    ];
    for (const [message, code, resource] of cases) {
        const result = classifyMapCSPResources(message);
        assert.deepEqual(result, [{code, resource}]);
        assert.ok(result.every(item => mapCSPDiagnosticCodes.includes(item.code) && isMapCSPResource(item.resource)));
        assert.doesNotMatch(JSON.stringify(result), /secret|private|token|\/\/|\?/);
    }
});

test("unknown or malformed CSP resources stay bounded and URL contents cannot become diagnostic data", () => {
    for (const [url, resource] of [["https://webapi.amap.com.evil.invalid/path?key=secret", "redacted"],
        ["https://webapi.amap.com:8443/private", "https:webapi.amap.com"],
        ["http://unknown.invalid/unsafe-eval?blob:secret", "redacted"], ["file:///secret", "other"],
        ["not a URL private", "other"], ["blob:https://private.invalid/secret", "blob"]]) {
        const result = classifyMapCSPResources(`Loading the script '${url}' violates the following Content Security Policy directive: "script-src https://webapi.amap.com".`);
        assert.deepEqual(result, [{code: "cspScript", resource}]);
    }
    for (const message of [undefined, {}, "provider secret text", "Content Security Policy unknown directive private",
        "Loading the script 'https://private.invalid' violates a made-up directive",
        "Loading the script 'https://webapi.amap.com/" + "private".repeat(5000) + "' violates Content Security Policy directive: \"script-src 'none'\"."]) {
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

test("resource validator accepts only fixed codes or short canonical hostnames in bounded public domain families", () => {
    for (const resource of [...mapCSPResourceCodes, "https:webapi.amap.com", "https:wprd01.is.autonavi.com",
        "http:g.alicdn.com", "https:fourier.taobao.com", "https:jsapi0.amap.com"]) {
        assert.equal(isMapCSPResource(resource), true, resource);
    }
    for (const resource of [undefined, null, {}, ["blob"], "https://webapi.amap.com", "https:webapi.amap.com:8443",
        "https:webapi.amap.com/private", "https:webapi.amap.com?key=secret", "https:webapi.amap.com#secret",
        "https:secret@webapi.amap.com", "https:webapi.amap.com.evil.invalid", "https:notamap.com",
        "https:unknown.example", "https:127.0.0.1", "https:[::1]", "https:machine.local", "https:localhost",
        "HTTPS:webapi.amap.com", "https:WEBAPI.amap.com", "https:1234567890.amap.com", "https:bad-.amap.com",
        "https:" + "a".repeat(25) + ".amap.com", "https:" + ("a".repeat(24) + ".").repeat(4) + "amap.com"]) {
        assert.equal(isMapCSPResource(resource), false, String(resource));
    }
    assert.equal(MAX_MAP_DIAGNOSTICS, 64);
});

test("suspicious public host labels are redacted while the effective blocked directive survives", () => {
    for (const host of ["unknown.example", "amap.com.evil.example", "a".repeat(25) + ".amap.com",
        ("a".repeat(24) + ".").repeat(4) + "amap.com", "1234567890.amap.com", "bad-.amap.com"]) {
        const message = `Loading the script 'https://${host}/private?key=secret' violates the following Content Security Policy directive: "script-src https://webapi.amap.com".`;
        assert.deepEqual(classifyMapCSPResources(message), [{code: "cspScript", resource: "redacted"}]);
    }
});
