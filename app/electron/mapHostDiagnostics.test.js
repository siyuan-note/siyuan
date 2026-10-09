const assert = require("node:assert/strict");
const {test} = require("node:test");
const {mapDiagnosticCodes, classifyMapConsoleMessage} = require("./mapHostDiagnostics");

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
