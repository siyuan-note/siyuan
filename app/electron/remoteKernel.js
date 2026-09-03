const crypto = require("node:crypto");

// 解析命令行参数时保留值中的等号，避免 URL 查询参数被截断。
const getArgFrom = (args, name) => {
    const prefix = name + "=";
    const arg = args.find((item) => item === name || item.startsWith(prefix));
    if (!arg) {
        return;
    }
    return arg === name ? "" : arg.slice(prefix.length);
};

const normalizeRemoteKernelOrigin = (value) => {
    if (!value) {
        throw new Error("--remote requires a URL");
    }
    const url = new URL(value);
    if (url.username || url.password) {
        throw new Error("--remote does not accept credentials in the URL");
    }
    if (url.pathname !== "/" || url.search || url.hash || value.includes("?") || value.includes("#")) {
        throw new Error("--remote only accepts an origin without a path, query, or fragment");
    }
    if (url.protocol !== "https:") {
        throw new Error("--remote requires HTTPS");
    }
    return url.origin;
};

const insecureCertificateSwitchNames = Object.freeze([
    "allow-insecure-localhost",
    "ignore-certificate-errors",
    "ignore-certificate-errors-spki-list",
    "ignore-ssl-errors",
    "ignore-ssl-errors-with-hosts",
]);
const insecureCertificateSwitches = new Set(insecureCertificateSwitchNames);
const unsafeRemoteChromiumSwitchNames = Object.freeze([
    ...insecureCertificateSwitchNames,
    "allow-running-insecure-content",
    "disable-site-isolation-for-policy",
    "disable-site-isolation-trials",
    "disable-web-security",
]);
const unsafeRemoteChromiumSwitches = new Set(unsafeRemoteChromiumSwitchNames);
const remoteKernelActiveStorageTypes = Object.freeze(["serviceworkers", "cachestorage"]);

const getInsecureCertificateSwitchName = (arg) => {
    if (typeof arg !== "string" || !arg.startsWith("--")) {
        return;
    }
    const name = arg.slice(2).split("=", 1)[0].toLowerCase();
    return insecureCertificateSwitches.has(name) ? name : undefined;
};

const getUnsafeRemoteChromiumSwitchName = (arg) => {
    if (typeof arg !== "string" || !arg.startsWith("--")) {
        return;
    }
    const name = arg.slice(2).split("=", 1)[0].toLowerCase();
    if (name === "disable-features") {
        const disabledFeatures = arg.slice(arg.indexOf("=") + 1).toLowerCase().split(",");
        if (disabledFeatures.some((feature) => ["isolateorigins", "site-per-process", "siteperprocess"]
            .includes(feature.trim()))) {
            return name;
        }
    }
    return unsafeRemoteChromiumSwitches.has(name) ? name : undefined;
};

const isAllowedRemoteExternalURL = (value) => {
    try {
        return ["http:", "https:"].includes(new URL(value).protocol);
    } catch (error) {
        return false;
    }
};

const deniedAPIPaths = new Set([
    "/api/system/checkUpdate",
    "/api/system/createWorkspaceDir",
    "/api/system/exit",
    "/api/system/removeWorkspaceDir",
    "/api/system/removeWorkspaceDirPhysically",
    "/api/system/setDownloadInstallPkg",
    "/api/system/setNetworkServe",
    "/api/system/setNetworkServeTLS",
    "/api/system/setUpdateChannel",
    "/api/system/setWorkspaceDir",
    "/api/system/uiproc",
]);
const documentDestinations = new Set(["document", "embed", "frame", "iframe", "object"]);
const executableDestinations = new Set([
    "audioworklet",
    "paintworklet",
    "script",
    "serviceworker",
    "sharedworker",
    "style",
    "worker",
    "worklet",
    "xslt",
]);
const localExecutableDestinations = new Set(["script", "style", "worker"]);
const localDocumentPaths = new Set([
    "/check-auth",
    "/stage/build/app/",
    "/stage/build/app/window.html",
]);
const webRequestDestinations = new Map([
    ["mainframe", "document"],
    ["object", "object"],
    ["script", "script"],
    ["serviceworker", "serviceworker"],
    ["sharedworker", "sharedworker"],
    ["stylesheet", "style"],
    ["subframe", "frame"],
    ["worker", "worker"],
]);

const getRemoteKernelWebRequestDestination = (resourceType) =>
    webRequestDestinations.get(String(resourceType || "").toLowerCase()) || "";

const normalizeRequestPathname = (pathname) => {
    const normalizedPathnames = [];
    let decoded = pathname;
    for (let count = 0; count < 8; count++) {
        let normalized = decoded.replaceAll("\\", "/").replace(/\/{2,}/g, "/");
        if (normalized.length > 1) {
            normalized = normalized.replace(/\/+$/, "");
        }
        if (!normalizedPathnames.includes(normalized)) {
            normalizedPathnames.push(normalized);
        }
        try {
            const next = decodeURIComponent(decoded);
            if (next === decoded) {
                break;
            }
            decoded = next;
        } catch (error) {
            break;
        }
    }
    return normalizedPathnames;
};

const isProtectedLocalPath = (pathname) => pathname === "/check-auth" || pathname === "/appearance" ||
    pathname.startsWith("/appearance/") || pathname === "/plugins" || pathname.startsWith("/plugins/") ||
    pathname === "/stage" || pathname.startsWith("/stage/") || pathname === "/widgets" ||
    pathname.startsWith("/widgets/");

const getRemoteKernelRequestPolicy = ({method, pathname, destination, localResourceAvailable, isTargetOrigin = true}) => {
    const requestedPathname = pathname;
    const normalizedPathnames = normalizeRequestPathname(pathname);
    if (isTargetOrigin && normalizedPathnames.some((candidate) => deniedAPIPaths.has(candidate))) {
        return "deny-api";
    }
    pathname = normalizedPathnames[normalizedPathnames.length - 1];
    const safeMethod = method === "GET" || method === "HEAD";
    if (documentDestinations.has(destination)) {
        return isTargetOrigin && safeMethod && localResourceAvailable && localDocumentPaths.has(requestedPathname)
            ? "local"
            : "deny-active-content";
    }
    if (executableDestinations.has(destination)) {
        return isTargetOrigin && safeMethod && localResourceAvailable && localExecutableDestinations.has(destination)
            ? "local"
            : "deny-active-content";
    }
    if (!isTargetOrigin) {
        return "remote";
    }
    if (!safeMethod) {
        return "remote";
    }
    if (localResourceAvailable) {
        return "local";
    }
    if (normalizedPathnames.some(isProtectedLocalPath)) {
        return "not-found";
    }
    return "remote";
};

const getRemoteKernelRedirectDecision = ({status, location, origin, method}) => {
    if (![301, 302, 303, 307, 308].includes(status)) {
        return {action: "none"};
    }
    if (!location) {
        return {action: "deny"};
    }
    let url;
    try {
        url = new URL(location, origin);
    } catch (error) {
        return {action: "deny"};
    }
    if (url.origin !== origin || url.username || url.password) {
        return {action: "deny"};
    }
    let redirectMethod = method;
    if ((status === 303 && method !== "HEAD") ||
        ((status === 301 || status === 302) && method === "POST")) {
        redirectMethod = "GET";
    }
    return {
        action: "follow",
        method: redirectMethod,
        url,
    };
};

const getRemoteKernelVersionStatus = (versionData, expectedVersion) => {
    if (!versionData || versionData.code !== 0 || typeof versionData.data !== "string") {
        return "invalid";
    }
    return versionData.data === expectedVersion ? "compatible" : "mismatch";
};

const shouldForwardRemoteDeepLink = ({currentOrigin, requestedOrigin, remoteArgumentPresent, localTargetRequested}) =>
    Boolean(currentOrigin) && !localTargetRequested &&
    (!remoteArgumentPresent || requestedOrigin === currentOrigin);

const shouldBlockRemoteFrameNavigation = ({isMainFrame, resourceType}) => isMainFrame === false ||
    ["object", "subFrame"].includes(resourceType);

const shouldTrustLocalKernelCertificate = (kernelMode, hostname) => kernelMode === "local" &&
    ["127.0.0.1", "localhost"].includes(String(hostname).toLowerCase());

const decodeHTMLAttributeValue = (value) => value.replace(/&(#(?:x[\da-f]+|\d+)|amp|apos|gt|lt|quot);?/gi,
    (match, entity) => {
        const normalizedEntity = entity.toLowerCase();
        if (normalizedEntity.startsWith("#x")) {
            const codePoint = Number.parseInt(normalizedEntity.slice(2), 16);
            return Number.isSafeInteger(codePoint) && codePoint <= 0x10FFFF
                ? String.fromCodePoint(codePoint)
                : match;
        }
        if (normalizedEntity.startsWith("#")) {
            const codePoint = Number.parseInt(normalizedEntity.slice(1), 10);
            return Number.isSafeInteger(codePoint) && codePoint <= 0x10FFFF
                ? String.fromCodePoint(codePoint)
                : match;
        }
        return {
            amp: "&",
            apos: "'",
            gt: ">",
            lt: "<",
            quot: "\"",
        }[normalizedEntity];
    });

const parseHTMLAttributes = (source) => {
    const attributes = [];
    let offset = 0;
    while (offset < source.length) {
        while (/\s/.test(source[offset])) {
            offset++;
        }
        if (offset >= source.length || source[offset] === "/") {
            break;
        }
        const nameStart = offset;
        while (offset < source.length && !/[\s=/>]/.test(source[offset])) {
            offset++;
        }
        if (offset === nameStart) {
            offset++;
            continue;
        }
        const name = source.slice(nameStart, offset).toLowerCase();
        while (/\s/.test(source[offset])) {
            offset++;
        }
        let value;
        if (source[offset] === "=") {
            offset++;
            while (/\s/.test(source[offset])) {
                offset++;
            }
            const quote = source[offset] === "\"" || source[offset] === "'" ? source[offset++] : undefined;
            const valueStart = offset;
            if (quote) {
                while (offset < source.length && source[offset] !== quote) {
                    offset++;
                }
                value = source.slice(valueStart, offset);
                if (source[offset] === quote) {
                    offset++;
                }
            } else {
                while (offset < source.length && !/[\s>]/.test(source[offset])) {
                    offset++;
                }
                value = source.slice(valueStart, offset);
            }
        }
        attributes.push({name, value});
    }
    return attributes;
};

const findHTMLTagEnd = (html, start) => {
    let quote;
    for (let offset = start; offset < html.length; offset++) {
        const character = html[offset];
        if (quote) {
            if (character === quote) {
                quote = undefined;
            }
        } else if (character === "\"" || character === "'") {
            quote = character;
        } else if (character === ">") {
            return offset;
        }
    }
    return -1;
};

const normalizeHTMLScriptSource = (source) => source.replace(/\r\n?/g, "\n");

const getRemoteDocumentInlineScriptSources = (html) => {
    const inlineScripts = [];
    const eventHandlers = [];
    const lowerHTML = html.toLowerCase();
    const rawTextElements = new Set(["iframe", "noembed", "noframes", "noscript", "style", "textarea", "title", "xmp"]);
    let offset = 0;
    while (offset < html.length) {
        const tagStart = html.indexOf("<", offset);
        if (tagStart < 0) {
            break;
        }
        if (html.startsWith("<!--", tagStart)) {
            const commentEnd = html.indexOf("-->", tagStart + 4);
            offset = commentEnd < 0 ? html.length : commentEnd + 3;
            continue;
        }
        const tagEnd = findHTMLTagEnd(html, tagStart + 1);
        if (tagEnd < 0) {
            break;
        }
        const tagSource = html.slice(tagStart + 1, tagEnd);
        const tagMatch = /^\s*([a-z][\w:-]*)\b/i.exec(tagSource);
        if (!tagMatch) {
            offset = tagEnd + 1;
            continue;
        }
        const tagName = tagMatch[1].toLowerCase();
        const attributes = parseHTMLAttributes(tagSource.slice(tagMatch[0].length));
        for (const attribute of attributes) {
            if (attribute.name.startsWith("on") && attribute.name.length > 2 && attribute.value !== undefined) {
                eventHandlers.push(normalizeHTMLScriptSource(decodeHTMLAttributeValue(attribute.value)));
            }
        }
        if (tagName !== "script" && !rawTextElements.has(tagName)) {
            offset = tagEnd + 1;
            continue;
        }
        const closeTagStart = lowerHTML.indexOf("</" + tagName, tagEnd + 1);
        if (closeTagStart < 0) {
            offset = tagEnd + 1;
            continue;
        }
        if (tagName === "script" && !attributes.some((attribute) => attribute.name === "src")) {
            inlineScripts.push(normalizeHTMLScriptSource(html.slice(tagEnd + 1, closeTagStart)));
        }
        const closeTagEnd = html.indexOf(">", closeTagStart + tagName.length + 2);
        offset = closeTagEnd < 0 ? html.length : closeTagEnd + 1;
    }
    return {eventHandlers, inlineScripts};
};

const createRemoteDocumentContentSecurityPolicy = (html, origin) => {
    const {inlineScripts} = getRemoteDocumentInlineScriptSources(html);
    const hashes = [...new Set(inlineScripts.map((source) =>
        "'sha256-" + crypto.createHash("sha256").update(source, "utf8").digest("base64") + "'"))];
    const stageSource = new URL("/stage/", origin).href;
    const appearanceSource = new URL("/appearance/", origin).href;
    const defaultIconSource = new URL("/appearance/icons/litheness/icon.js", origin).href;
    const scriptSources = [stageSource, defaultIconSource, "blob:", "'wasm-unsafe-eval'", ...hashes];
    return [
        "base-uri " + new URL("/", origin).href,
        "child-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "script-src " + scriptSources.join(" "),
        "script-src-attr 'none'",
        "style-src 'unsafe-inline' " + stageSource + " " + appearanceSource,
        "worker-src " + stageSource,
    ].join("; ");
};

module.exports = {
    createRemoteDocumentContentSecurityPolicy,
    getArgFrom,
    getInsecureCertificateSwitchName,
    getRemoteKernelRedirectDecision,
    getRemoteKernelRequestPolicy,
    getRemoteKernelWebRequestDestination,
    getRemoteKernelVersionStatus,
    getUnsafeRemoteChromiumSwitchName,
    getRemoteDocumentInlineScriptSources,
    normalizeRemoteKernelOrigin,
    remoteKernelActiveStorageTypes,
    insecureCertificateSwitchNames,
    isAllowedRemoteExternalURL,
    shouldBlockRemoteFrameNavigation,
    shouldForwardRemoteDeepLink,
    shouldTrustLocalKernelCertificate,
    unsafeRemoteChromiumSwitchNames,
};
