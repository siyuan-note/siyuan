import * as crypto from "node:crypto";
import {APP_PAGE, CHECK_AUTH_PAGE, SETTINGS_PAGE, WINDOW_PAGE} from "../shared/pagePaths";
import type {KernelTarget} from "../shared/types";

type RemoteKernelTarget = KernelTarget & {
    trustRemoteExtensions: boolean;
    extensionScriptNonce?: string;
};

type ConnectionTarget = KernelTarget & {
    trustRemoteExtensions?: boolean;
    extensionScriptNonce?: string;
};

type KernelConnection = {
    kernelMode: string;
    ownsKernel: boolean;
    kernelOrigin: string;
    trustRemoteExtensions: boolean;
    extensionScriptNonce?: string;
};

type RemoteRequestPolicy = "deny-api" | "deny-active-content" | "local" | "remote" | "not-found";

type RemoteRedirectDecision =
    | {action: "none"}
    | {action: "deny"}
    | {action: "follow"; method: string; url: URL};

const normalizeRemoteKernelOrigin = (value: string): string => {
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

const createRemoteKernelTarget = (value: string, args: string[]): RemoteKernelTarget => {
    const origin = normalizeRemoteKernelOrigin(value);
    const trustRemoteExtensions = args.includes("--trust-remote-extensions");
    return {
        mode: "remote",
        origin,
        ownsKernel: false,
        port: "",
        trustRemoteExtensions,
        extensionScriptNonce: trustRemoteExtensions ? crypto.randomBytes(32).toString("base64") : undefined,
    };
};

const getKernelConnection = (target?: ConnectionTarget | null): KernelConnection | undefined => target ? {
    kernelMode: target.mode,
    ownsKernel: target.ownsKernel,
    kernelOrigin: target.origin,
    trustRemoteExtensions: target.mode === "remote" && target.trustRemoteExtensions === true,
    extensionScriptNonce: target.mode === "remote" && target.trustRemoteExtensions === true
        ? target.extensionScriptNonce : undefined,
} : undefined;

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
// 远端内核只需要清掉可能带旧前端资源的存储，其余会话数据保留登录态。
const remoteKernelActiveStorageTypes: readonly ("serviceworkers" | "cachestorage")[] =
    Object.freeze(["serviceworkers", "cachestorage"]);

const getInsecureCertificateSwitchName = (arg: string): string | undefined => {
    if (typeof arg !== "string" || !arg.startsWith("--")) {
        return;
    }
    const name = arg.slice(2).split("=", 1)[0].toLowerCase();
    return insecureCertificateSwitches.has(name) ? name : undefined;
};

const getUnsafeRemoteChromiumSwitchName = (arg: string): string | undefined => {
    if (typeof arg !== "string" || !arg.startsWith("--")) {
        return;
    }
    const name = arg.slice(2).split("=", 1)[0].toLowerCase();
    if (name === "disable-features") {
        const disabledFeatures = arg.slice(arg.indexOf("=") + 1).toLowerCase().split(",");
        // 去除 Chromium 功能名后的试验名称，防止绕过远程模式的安全限制。
        if (disabledFeatures.some((feature) => ["isolateorigins", "site-per-process", "siteperprocess"]
            .includes(feature.split("<", 1)[0].trim()))) {
            return name;
        }
    }
    return unsafeRemoteChromiumSwitches.has(name) ? name : undefined;
};

const isAllowedRemoteExternalURL = (value: string): boolean => {
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
    CHECK_AUTH_PAGE,
    APP_PAGE,
    WINDOW_PAGE,
    SETTINGS_PAGE,
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

const getRemoteKernelWebRequestDestination = (resourceType?: string): string =>
    webRequestDestinations.get(String(resourceType || "").toLowerCase()) || "";

const normalizeRequestPathname = (pathname: string): string[] => {
    const normalizedPathnames: string[] = [];
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

const isProtectedLocalPath = (pathname: string): boolean => pathname === CHECK_AUTH_PAGE || pathname === "/appearance" ||
    pathname.startsWith("/appearance/") || pathname === "/plugins" || pathname.startsWith("/plugins/") ||
    pathname === "/stage" || pathname.startsWith("/stage/") || pathname === "/widgets" ||
    pathname.startsWith("/widgets/");

// 内置外观和前端始终由客户端提供，自定义扩展只从当前远程内核加载。
const isRemoteExtensionPath = (pathname: string): boolean => !pathname.split("/").some((part: string) => part === "." || part === "..") &&
    (pathname.startsWith("/plugins/") || (/^\/appearance\/(themes|icons)\//.test(pathname) &&
        !/^\/appearance\/(themes\/(daylight|midnight)|icons\/litheness)(\/|$)/.test(pathname)));

const getRemoteKernelRequestPolicy = ({method, pathname, destination, localResourceAvailable, isTargetOrigin = true,
    trustRemoteExtensions = false}: {
        method: string;
        pathname: string;
        destination: string;
        localResourceAvailable: boolean;
        isTargetOrigin?: boolean;
        trustRemoteExtensions?: boolean;
    }): RemoteRequestPolicy => {
    const requestedPathname = pathname;
    const normalizedPathnames = normalizeRequestPathname(pathname);
    if (isTargetOrigin && normalizedPathnames.some((candidate) => deniedAPIPaths.has(candidate))) {
        return "deny-api";
    }
    pathname = normalizedPathnames[normalizedPathnames.length - 1];
    const safeMethod = method === "GET" || method === "HEAD";
    const remoteExtension = trustRemoteExtensions && isTargetOrigin && safeMethod &&
        normalizedPathnames.every(isRemoteExtensionPath);
    if (documentDestinations.has(destination)) {
        return isTargetOrigin && safeMethod && localResourceAvailable && localDocumentPaths.has(requestedPathname)
            ? "local"
            : "deny-active-content";
    }
    if (executableDestinations.has(destination)) {
        if (remoteExtension && localExecutableDestinations.has(destination)) {
            return "remote";
        }
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
    if (remoteExtension) {
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

const getRemoteKernelRedirectDecision = ({status, location, origin, method}: {status: number; location?: string; origin: string; method: string}): RemoteRedirectDecision => {
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

const getRemoteKernelVersionStatus = (versionData: {code?: number; data?: unknown} | null | undefined,
    expectedVersion: string): "invalid" | "compatible" | "mismatch" => {
    if (!versionData || versionData.code !== 0 || typeof versionData.data !== "string") {
        return "invalid";
    }
    return versionData.data === expectedVersion ? "compatible" : "mismatch";
};

const shouldForwardRemoteDeepLink = ({currentOrigin, requestedOrigin, remoteArgumentPresent,
    localTargetRequested}: {
        currentOrigin?: string;
        requestedOrigin?: string;
        remoteArgumentPresent: boolean;
        localTargetRequested: boolean;
    }): boolean =>
    Boolean(currentOrigin) && !localTargetRequested &&
    (!remoteArgumentPresent || requestedOrigin === currentOrigin);

const shouldBlockRemoteFrameNavigation = ({isMainFrame, resourceType}: {isMainFrame?: boolean; resourceType?: string}): boolean => isMainFrame === false ||
    ["object", "subFrame"].includes(resourceType || "");

const shouldTrustLocalKernelCertificate = (kernelMode: string, hostname: string): boolean => kernelMode === "local" &&
    ["127.0.0.1", "localhost"].includes(String(hostname).toLowerCase());

export {
    createRemoteKernelTarget,
    getKernelConnection,
    getInsecureCertificateSwitchName,
    getRemoteKernelRedirectDecision,
    getRemoteKernelRequestPolicy,
    getRemoteKernelWebRequestDestination,
    getRemoteKernelVersionStatus,
    getUnsafeRemoteChromiumSwitchName,
    normalizeRemoteKernelOrigin,
    remoteKernelActiveStorageTypes,
    insecureCertificateSwitchNames,
    isAllowedRemoteExternalURL,
    shouldBlockRemoteFrameNavigation,
    shouldForwardRemoteDeepLink,
    shouldTrustLocalKernelCertificate,
    unsafeRemoteChromiumSwitchNames,
};
