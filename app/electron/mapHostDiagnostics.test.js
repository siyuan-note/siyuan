const assert = require("node:assert/strict");
const {test} = require("node:test");
const {mapDiagnosticCodes, mapCSPDiagnosticCodes, mapCSPResourceCodes, classifyMapConsoleMessage,
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

test("Chromium CSP messages identify fixed resource categories without retaining their URLs", () => {
    // Chromium 152 的三类资源拒绝文案，以及旧式 Refused to 文案。
    const cases = [
        ["Loading the script 'https://g.alicdn.com/private.js?key=secret' violates the following Content Security Policy directive: \"script-src https://webapi.amap.com\". The action has been blocked.", "cspScript", "https:g.alicdn.com"],
        ["Connecting to 'https://fourier.taobao.com/rp?secret=private' violates the following Content Security Policy directive: \"connect-src https://webapi.amap.com\".", "cspConnect", "https:fourier.taobao.com"],
        ["Creating a worker from 'blob:null/private-token' violates the following Content Security Policy directive: \"worker-src 'none'\".", "cspWorker", "blob"],
        ["Refused to create a worker from 'data:text/javascript,private' because it violates the following Content Security Policy directive: \"worker-src 'none'\".", "cspWorker", "data"],
        ["Refused to load the script 'https://private@restapi.amap.com/log?key=secret' because it violates the following Content Security Policy directive: \"script-src https://webapi.amap.com\".", "cspScript", "https:restapi.amap.com"],
        ["Refused to connect to 'http://vdata.amap.com/private' because it violates the following Content Security Policy directive: \"connect-src https://vdata.amap.com\".", "cspConnect", "http:vdata.amap.com"],
        ["Connecting to 'https://webst02.is.autonavi.com/private' violates the following Content Security Policy directive: \"connect-src https://vdata.amap.com\".", "cspConnect", "https:autonavi-tile"],
        ["Loading the image 'http://webrd01.is.autonavi.com/private' violates the following Content Security Policy directive: \"img-src https://webapi.amap.com\".", "cspImage", "http:autonavi-tile"],
        ["Executing inline script violates the following Content Security Policy directive 'script-src https://webapi.amap.com'. Either the 'unsafe-inline' keyword, a hash, or a nonce is required.", "cspScript", "inline"],
        ["Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: \"script-src https://webapi.amap.com\".", "cspEval", "eval"],
        ["Compiling or instantiating a WebAssembly module violates the following Content Security policy directive because 'unsafe-eval' is not an allowed source of script: \"script-src https://webapi.amap.com\".", "cspWasm", "wasm"],
        ["Applying inline style violates the following Content Security Policy directive 'style-src-attr https://webapi.amap.com'.", "cspStyle", "inline"],
    ];
    for (const [message, code, resource] of cases) {
        const result = classifyMapCSPResources(message);
        assert.deepEqual(result, [{code, resource}]);
        assert.ok(result.every(item => mapCSPDiagnosticCodes.includes(item.code) && mapCSPResourceCodes.includes(item.resource)));
        assert.doesNotMatch(JSON.stringify(result), /secret|private|token|\/\/|\?/);
    }
});

test("unknown or malformed CSP resources stay bounded and URL contents cannot become diagnostic data", () => {
    for (const [url, resource] of [["https://webapi.amap.com.evil.invalid/path?key=secret", "https:other"],
        ["https://webapi.amap.com:8443/private", "https:other"],
        ["http://unknown.invalid/unsafe-eval?blob:secret", "http:other"], ["file:///secret", "other"],
        ["not a URL private", "other"], ["blob:https://private.invalid/secret", "blob"]]) {
        const result = classifyMapCSPResources(`Loading the script '${url}' violates the following Content Security Policy directive: "script-src https://webapi.amap.com".`);
        assert.deepEqual(result, [{code: "cspScript", resource}]);
    }
    for (const message of [undefined, {}, "provider secret text", "Content Security Policy unknown directive private",
        "Loading the script 'https://private.invalid' violates a made-up directive"]) {
        assert.deepEqual(classifyMapCSPResources(message), []);
    }
});
