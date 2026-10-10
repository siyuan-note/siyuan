// 仅返回固定分类或受限公共主机名，不转发 SDK 日志、完整地址、脚本片段或凭据。
const MAX_MAP_DIAGNOSTICS = 64;
const mapDiagnosticCodes = Object.freeze([
    "hostSetupFailed", "assetUnavailable", "documentLoadFailed", "bootstrapTimeout", "sdkTimeout",
    "providerRequestDenied", "providerInsecureRequest", "providerHTTPFailure", "providerNetworkFailure",
    "cspScript", "cspWorker", "cspConnect", "cspImage", "cspStyle", "cspEval", "cspWasm",
    "storageUnavailable", "webglUnavailable", "geometryInvalid", "geometryLogicalBounds",
    "geometryCropBounds", "geometryWindowBounds", "geometryRoundedEmpty",
]);
const mapCSPDiagnosticCodes = Object.freeze(["cspScript", "cspWorker", "cspConnect", "cspImage", "cspStyle", "cspEval", "cspWasm"]);
const mapCSPResourceCodes = Object.freeze([
    "blob", "data", "inline", "eval", "wasm", "other",
    "owner-origin", "local-address", "redacted",
]);
const isMapCSPHostname = value => value === "tiles.openfreemap.org";
const isMapCSPResource = value => {
    if (typeof value !== "string" || value.length > 102) return false;
    if (mapCSPResourceCodes.includes(value)) return true;
    const hostname = /^https?:([a-z0-9.-]+)$/.exec(value)?.[1];
    return isMapCSPHostname(hostname);
};

const classifyMapCSPResources = (message, ownerOrigin) => {
    if (typeof message !== "string" || message.length > 32768 || !/content security policy/i.test(message)) return [];
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
                    const hostname = url.hostname;
                    const local = !hostname.includes(".") || hostname.startsWith("[") ||
                        /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
                        /(?:^|\.)(?:localhost|local|internal|lan|home)$/.test(hostname);
                    resource = url.username || url.password ? "redacted" : url.origin === ownerOrigin ? "owner-origin" :
                        local ? "local-address" : isMapCSPHostname(hostname) ? url.protocol + hostname : "redacted";
                }
            } catch (_error) { /* 未识别资源只保留固定 other 类别。 */ }
        }
    }
    return isMapCSPResource(resource) ? [{code, resource}] : [];
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
    return ret;
};

module.exports = {MAX_MAP_DIAGNOSTICS, mapDiagnosticCodes, mapCSPDiagnosticCodes, mapCSPResourceCodes,
    isMapCSPResource, classifyMapConsoleMessage, classifyMapCSPResources};
