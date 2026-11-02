import * as fs from "node:fs";
import * as path from "node:path";
import {pathToFileURL} from "node:url";
import * as electron from "electron";
import {paths, writeLog} from "../shared/runtime";
import {APP_PAGE, CHECK_AUTH_PAGE, SETTINGS_PAGE, WINDOW_PAGE} from "../shared/pagePaths";
import {getRemoteSession} from "./connectionManager";
import {resolveAppLanguage} from "../shared/language";
import {probeRemoteKernelAuthentication} from "./remoteKernelAuth";
import {
    getRemoteKernelRedirectDecision,
    getRemoteKernelRequestPolicy,
    getRemoteKernelWebRequestDestination,
    getRemoteKernelVersionStatus,
    shouldBlockRemoteFrameNavigation,
} from "./remoteKernel";
import {createRemoteDocumentContentSecurityPolicy} from "./remoteDocument";
import type {KernelTarget} from "../shared/types";

type RemoteResponse = {
    ok: boolean;
    status: number;
    body?: {cancel: () => Promise<void>} | null;
    headers: {get: (name: string) => string | null};
    json: () => Promise<unknown>;
};

type RemoteSession = {
    webRequest: {
        onBeforeRequest: (listener: (details: {url: string; method: string; resourceType: string},
            callback: (response: {cancel: boolean}) => void) => void) => void;
    };
    protocol: {
        handle: (scheme: string, handler: (request: Request) => Promise<Response>) => void;
    };
    fetch: (input: string | Request, init?: Record<string, unknown>) => Promise<RemoteResponse>;
};

const PLAIN_TEXT_HEADERS = {"Content-Type": "text/plain; charset=utf-8"};
// 错误响应一律不缓存：切换连接后版本与认证状态都会变。
const NO_STORE_TEXT_HEADERS = {"Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8"};

// 远端内核的前端仍由本机提供，因此协议处理器只需要安装一次。
let installed = false;

// 只映射本机的 stage 与 appearance 资源，其余一律拒绝，避免路径穿越读到任意文件。
const getLocalRemoteResource = (pathname: string): string | undefined => {
    let decodedPath: string;
    try {
        decodedPath = decodeURIComponent(pathname);
    } catch (error) {
        return;
    }
    if (decodedPath.includes("\0")) {
        return;
    }

    if (decodedPath === CHECK_AUTH_PAGE) {
        return path.join(paths.assetsDir, "remote-auth.html");
    }

    let resourceRoot: string;
    let relativePath: string;
    if (decodedPath.startsWith("/stage/")) {
        resourceRoot = path.join(paths.appDir, "stage");
        relativePath = decodedPath.slice("/stage/".length);
    } else if (decodedPath.startsWith("/appearance/")) {
        resourceRoot = path.join(paths.appDir, "appearance");
        relativePath = decodedPath.slice("/appearance/".length);
    } else {
        return;
    }

    let resourcePath = path.resolve(resourceRoot, relativePath);
    const relative = path.relative(resourceRoot, resourcePath);
    if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) {
        if (!relative && decodedPath.endsWith("/")) {
            resourcePath = path.join(resourcePath, "index.html");
        } else {
            return;
        }
    }
    try {
        if (fs.statSync(resourcePath).isDirectory()) {
            resourcePath = path.join(resourcePath, "index.html");
        }
        if (fs.statSync(resourcePath).isFile()) {
            return resourcePath;
        }
    } catch (error) {
        return;
    }
};

// 超时覆盖响应头和响应体读取，防止本机通道异常时启动查询永久挂起。
const remoteRequestTimeout = 5000;

const fetchWithTimeout = async (target: KernelTarget, url: string,
    init: Record<string, unknown> = {}): Promise<RemoteResponse> => {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), remoteRequestTimeout);
    try {
        return await (getRemoteSession(target) as unknown as RemoteSession).fetch(url, Object.assign({
            credentials: "include",
            bypassCustomProtocolHandlers: true,
            redirect: "manual",
        }, init, {signal: abortController.signal}));
    } finally {
        clearTimeout(timer);
    }
};

type RemoteVersionPayload = {code?: number; data?: string};

const requestRemoteKernelVersion = async (target: KernelTarget): Promise<RemoteVersionPayload> => {
    const response = await fetchWithTimeout(target, target.origin + "/api/system/version", {method: "GET"});
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error("version request returned HTTP " + response.status);
    }
    return response.json() as Promise<RemoteVersionPayload>;
};

const isRemoteKernelAuthenticated = (target: KernelTarget): Promise<boolean> =>
    probeRemoteKernelAuthentication({
        session: getRemoteSession(target), url: target.origin + APP_PAGE,
    });

const installRemoteFrontendProtocol = (target: KernelTarget): void => {
    if (installed) {
        return;
    }
    const scheme = new URL(target.origin).protocol.slice(0, -1);
    const remoteSession = getRemoteSession(target) as unknown as RemoteSession;
    remoteSession.webRequest.onBeforeRequest((details, callback) => {
        const destination = getRemoteKernelWebRequestDestination(details.resourceType);
        let requestPolicy = "remote";
        if (destination) {
            try {
                const requestURL = new URL(details.url);
                const isTargetOrigin = requestURL.origin === target.origin;
                const localResource = isTargetOrigin ? getLocalRemoteResource(requestURL.pathname) : undefined;
                requestPolicy = getRemoteKernelRequestPolicy({
                    method: details.method,
                    pathname: requestURL.pathname,
                    destination,
                    localResourceAvailable: Boolean(localResource),
                    isTargetOrigin,
                    trustRemoteExtensions: target.trustRemoteExtensions,
                });
            } catch (error) {
                requestPolicy = "deny-active-content";
            }
        }
        callback({
            cancel: shouldBlockRemoteFrameNavigation({resourceType: details.resourceType}) ||
                requestPolicy === "deny-active-content",
        });
    });
    remoteSession.protocol.handle(scheme, async (request: Request): Promise<Response> => {
        const forwardRequest = (includeCredentials = false) => remoteSession.fetch(request, {
            bypassCustomProtocolHandlers: true,
            redirect: "manual",
            ...(includeCredentials ? {credentials: "include"} : {}),
        });
        let requestURL: URL | undefined;
        try {
            requestURL = new URL(request.url);
        } catch (error) {
            requestURL = undefined;
        }

        const isTargetOrigin = requestURL?.origin === target.origin;
        const requestPathname = requestURL?.pathname || "/";
        const localDocumentRequest = Boolean(isTargetOrigin && requestURL &&
            (request.method === "GET" || request.method === "HEAD") &&
            [CHECK_AUTH_PAGE, APP_PAGE, WINDOW_PAGE, SETTINGS_PAGE].includes(requestURL.pathname));
        const localResource = isTargetOrigin && requestURL && (request.method === "GET" || request.method === "HEAD")
            ? getLocalRemoteResource(requestURL.pathname)
            : undefined;
        const requestDestination = request.headers.get("sec-fetch-dest") || request.destination;
        const requestPolicy = getRemoteKernelRequestPolicy({
            method: request.method,
            pathname: requestPathname,
            destination: requestDestination,
            localResourceAvailable: Boolean(localResource),
            isTargetOrigin: Boolean(isTargetOrigin),
            trustRemoteExtensions: target.trustRemoteExtensions,
        });
        if (requestPolicy === "deny-api") {
            writeLog("blocked remote kernel lifecycle request [path=" + requestPathname + "]");
            return new Response(JSON.stringify({
                code: -1,
                msg: "This operation is unavailable in remote kernel mode.",
            }), {
                status: 403,
                headers: {"Content-Type": "application/json; charset=utf-8"},
            });
        }
        if (requestPolicy === "deny-active-content") {
            return new Response("Forbidden", {
                status: 403,
                headers: PLAIN_TEXT_HEADERS,
            });
        }
        if (!isTargetOrigin) {
            return forwardRequest() as unknown as Response;
        }
        if (requestPolicy === "local") {
            if (localDocumentRequest && requestURL) {
                let versionData;
                try {
                    versionData = await requestRemoteKernelVersion(target);
                } catch (error) {
                    writeLog("verify remote kernel version before loading local UI failed: " + (error as Error).message);
                    return new Response("Unable to verify the remote kernel version.", {
                        status: 502,
                        headers: NO_STORE_TEXT_HEADERS,
                    });
                }
                const versionStatus = getRemoteKernelVersionStatus(versionData, paths.appVer);
                if (versionStatus !== "compatible") {
                    writeLog("blocked local UI for an incompatible remote kernel [status=" + versionStatus + "]");
                    return new Response("The remote kernel version does not match this client.", {
                        status: 409,
                        headers: NO_STORE_TEXT_HEADERS,
                    });
                }
            }
            if (localDocumentRequest && requestURL &&
                [APP_PAGE, WINDOW_PAGE, SETTINGS_PAGE].includes(requestURL.pathname)) {
                try {
                    if (!await probeRemoteKernelAuthentication({
                        session: getRemoteSession(target), url: requestURL.href,
                    })) {
                        const authURL = new URL("/check-auth", target.origin);
                        authURL.searchParams.set("to", requestURL.pathname + requestURL.search);
                        authURL.searchParams.set("lang", resolveAppLanguage(electron.app.getPreferredSystemLanguages()));
                        authURL.searchParams.set("remote", "1");
                        return new Response(null, {
                            status: 302,
                            headers: {
                                "Cache-Control": "no-store",
                                Location: authURL.href,
                            },
                        });
                    }
                } catch (error) {
                    const statusCode = (error as {statusCode?: number}).statusCode;
                    writeLog("probe remote kernel authentication before loading local UI failed: " +
                        (error as Error).message);
                    return new Response("Remote kernel UI probe failed.", {
                        status: statusCode && statusCode >= 400 && statusCode <= 599 ? statusCode : 502,
                        headers: NO_STORE_TEXT_HEADERS,
                    });
                }
            }
            const localResponse = await electron.net.fetch(pathToFileURL(localResource as string).toString());
            if (localDocumentRequest && requestURL) {
                const responseHeaders = new Headers(localResponse.headers);
                responseHeaders.set("Cache-Control", "no-store");
                responseHeaders.set("Content-Security-Policy",
                    createRemoteDocumentContentSecurityPolicy(fs.readFileSync(localResource as string, "utf8"),
                        target.origin,
                        requestURL.pathname === "/check-auth" ? undefined : target.extensionScriptNonce));
                return new Response(localResponse.body, {
                    status: localResponse.status,
                    statusText: localResponse.statusText,
                    headers: responseHeaders,
                });
            }
            return new Response(localResponse.body, {
                status: localResponse.status,
                statusText: localResponse.statusText,
                headers: localResponse.headers,
            });
        }
        if (requestPolicy === "not-found") {
            return new Response("Not Found", {
                status: 404,
                headers: PLAIN_TEXT_HEADERS,
            });
        }

        const response = await forwardRequest(true);
        const redirectDecision = getRemoteKernelRedirectDecision({
            status: response.status,
            location: response.headers.get("location") as string | undefined,
            origin: target.origin,
            method: request.method,
        });
        if (redirectDecision.action === "none") {
            return response as unknown as Response;
        }
        if (redirectDecision.action === "deny") {
            await response.body?.cancel();
            writeLog("blocked remote kernel redirect outside the configured origin [path=" + requestPathname + "]");
            return new Response("Forbidden redirect", {
                status: 403,
                headers: PLAIN_TEXT_HEADERS,
            });
        }
        const redirectLocalResource = redirectDecision.method === "GET" || redirectDecision.method === "HEAD"
            ? getLocalRemoteResource(redirectDecision.url.pathname)
            : undefined;
        const redirectPolicy = getRemoteKernelRequestPolicy({
            method: redirectDecision.method,
            pathname: redirectDecision.url.pathname,
            destination: requestDestination,
            localResourceAvailable: Boolean(redirectLocalResource),
            isTargetOrigin: true,
            trustRemoteExtensions: target.trustRemoteExtensions,
        });
        if (redirectPolicy === "deny-api" || redirectPolicy === "deny-active-content" ||
            redirectPolicy === "not-found") {
            await response.body?.cancel();
            writeLog("blocked unsafe remote kernel redirect [path=" + redirectDecision.url.pathname +
                ", policy=" + redirectPolicy + "]");
            return new Response(redirectPolicy === "not-found" ? "Not Found" : "Forbidden redirect", {
                status: redirectPolicy === "not-found" ? 404 : 403,
                headers: PLAIN_TEXT_HEADERS,
            });
        }
        return response as unknown as Response;
    });
    installed = true;
    writeLog("installed local frontend handler for remote kernel [origin=" + target.origin + "]");
};

export {
    fetchWithTimeout, requestRemoteKernelVersion, isRemoteKernelAuthenticated,
    installRemoteFrontendProtocol,
};
export type {RemoteVersionPayload};
