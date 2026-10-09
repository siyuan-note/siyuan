// 仅返回固定分类，不转发 SDK 日志、请求地址、脚本片段或凭据。
const mapDiagnosticCodes = Object.freeze([
    "hostSetupFailed", "assetUnavailable", "documentLoadFailed", "bootstrapTimeout", "sdkTimeout",
    "providerRequestDenied", "providerInsecureRequest", "providerHTTPFailure", "providerNetworkFailure",
    "cspScript", "cspWorker", "cspConnect", "cspImage", "cspStyle", "cspEval", "cspWasm",
    "storageUnavailable", "webglUnavailable", "amapInvalidKey", "amapInvalidSecurityCode",
    "amapDomainMismatch", "amapPlatformMismatch",
]);
const mapCSPDiagnosticCodes = Object.freeze(["cspScript", "cspWorker", "cspConnect", "cspImage", "cspStyle", "cspEval", "cspWasm"]);
const mapCSPResourceCodes = Object.freeze([
    "blob", "data", "inline", "eval", "wasm", "other",
    "https:webapi.amap.com", "https:restapi.amap.com", "https:vdata.amap.com", "https:a.amap.com",
    "https:g.alicdn.com", "https:fourier.taobao.com", "https:autonavi-tile", "https:other",
    "http:webapi.amap.com", "http:restapi.amap.com", "http:vdata.amap.com", "http:a.amap.com",
    "http:g.alicdn.com", "http:fourier.taobao.com", "http:autonavi-tile", "http:other",
]);
const resourceHosts = Object.freeze(["webapi.amap.com", "restapi.amap.com", "vdata.amap.com", "a.amap.com",
    "g.alicdn.com", "fourier.taobao.com"]);

const classifyMapCSPResources = message => {
    if (typeof message !== "string" || !/content security policy/i.test(message)) return [];
    // Chromium 的 eval 文案在 directive 和实际策略之间还有原因，不能按资源 URL 解析。
    if (/^(?:Evaluating a string as JavaScript|Refused to evaluate a string as JavaScript)/i.test(message)) {
        return [{code: "cspEval", resource: "eval"}];
    }
    if (/^(?:Compiling or instantiating|Refused to compile or instantiate) a WebAssembly/i.test(message)) {
        return [{code: "cspWasm", resource: "wasm"}];
    }
    const directive = message.match(/content security policy directive:?\s*["'](worker-src|child-src|script-src(?:-elem|-attr)?|connect-src|img-src|style-src(?:-elem|-attr)?)\b/i)?.[1].toLowerCase();
    if (!directive) return [];
    const code = directive.startsWith("script-src") ? "cspScript" : directive.startsWith("style-src") ? "cspStyle" :
        ({"worker-src": "cspWorker", "child-src": "cspWorker", "connect-src": "cspConnect", "img-src": "cspImage"})[directive];
    let resource = "other";
    if (/^(?:Executing inline|Applying inline|Refused to execute inline|Refused to apply inline)/i.test(message)) {
        resource = "inline";
    } else {
        const target = message.match(/(?:loading the script|loading a script|load the script|connecting to|connect to|creating a worker from|create a worker from|loading the image|load the image|loading the stylesheet|load the stylesheet)\s*["']([^"']+)["']/i)?.[1];
        if (target?.startsWith("blob:")) resource = "blob";
        else if (target?.startsWith("data:")) resource = "data";
        else if (target) {
            try {
                const url = new URL(target);
                if (["https:", "http:"].includes(url.protocol)) {
                    const host = url.port ? "other" : resourceHosts.includes(url.hostname) ? url.hostname :
                        /^(?:webst|webrd)\d+\.is\.autonavi\.com$/.test(url.hostname) ? "autonavi-tile" : "other";
                    resource = url.protocol + host;
                }
            } catch (_error) { /* 未识别资源只保留固定 other 类别。 */ }
        }
    }
    return mapCSPResourceCodes.includes(resource) ? [{code, resource}] : [];
};

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

module.exports = {mapDiagnosticCodes, mapCSPDiagnosticCodes, mapCSPResourceCodes, classifyMapConsoleMessage, classifyMapCSPResources};
