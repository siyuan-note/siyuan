// 仅返回固定分类，不转发 SDK 日志、请求地址、脚本片段或凭据。
const mapDiagnosticCodes = Object.freeze([
    "hostSetupFailed", "assetUnavailable", "documentLoadFailed", "bootstrapTimeout", "sdkTimeout",
    "providerRequestDenied", "providerInsecureRequest", "providerHTTPFailure", "providerNetworkFailure",
    "cspScript", "cspWorker", "cspConnect", "cspImage", "cspStyle", "cspEval", "cspWasm",
    "storageUnavailable", "webglUnavailable", "amapInvalidKey", "amapInvalidSecurityCode",
    "amapDomainMismatch", "amapPlatformMismatch",
]);

const classifyMapConsoleMessage = message => {
    if (typeof message !== "string") return [];
    const ret = [];
    if (/content security policy|violates.*directive/i.test(message)) {
        for (const [token, code] of [["script-src", "cspScript"], ["worker-src", "cspWorker"],
            ["connect-src", "cspConnect"], ["img-src", "cspImage"], ["style-src", "cspStyle"],
            ["unsafe-eval", "cspEval"], ["wasm-unsafe-eval", "cspWasm"]]) {
            if (message.includes(token)) ret.push(code);
        }
    }
    if (/localStorage|sessionStorage/.test(message) && /denied|SecurityError|insecure/i.test(message)) ret.push("storageUnavailable");
    if (/webgl/i.test(message) && /fail|error|unsupported/i.test(message)) ret.push("webglUnavailable");
    for (const [token, code] of [["INVALID_USER_KEY", "amapInvalidKey"], ["INVALID_USER_SCODE", "amapInvalidSecurityCode"],
        ["INVALID_USER_DOMAIN", "amapDomainMismatch"], ["USERKEY_PLAT_NOMATCH", "amapPlatformMismatch"]]) {
        if (message.includes(token)) ret.push(code);
    }
    return ret;
};

module.exports = {mapDiagnosticCodes, classifyMapConsoleMessage};
