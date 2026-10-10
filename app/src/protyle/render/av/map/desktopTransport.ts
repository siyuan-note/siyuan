/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import type {AVMapHost, AVMapHostOptions} from "./host";
import {getAVMapVisibility} from "./host";
import {AV_MAP_OWNER_TIMEOUT} from "./loadingBudget";
import {
    AV_MAP_PROTOCOL_VERSION, AVMapCommand, AVMapErrorCode, AVMapPoint, isAVMapHostErrorCode, isAVMapProvider, isAVMapRevision,
    isAVMapTheme, parseAVMapReply, sanitizeAVMapPoints,
} from "./protocol";

const getIPC = () => {
    /// #if !BROWSER
    return ipcRenderer;
    /// #else
    return undefined;
    /// #endif
};

const capabilityFailureReasons = new Set([
    "ownerUnavailable", "notMainFrame", "notInitialized", "unregisteredOwner", "invalidKernelOrigin",
    "originMismatch", "unsupportedDocument", "invalidDocument", "unsafeProcessSwitches",
]);

const mapDiagnosticCodes = new Set([
    "hostSetupFailed", "assetUnavailable", "documentLoadFailed", "bootstrapTimeout", "sdkTimeout",
    "providerRequestDenied", "providerInsecureRequest", "providerHTTPFailure", "providerNetworkFailure",
    "cspScript", "cspWorker", "cspConnect", "cspImage", "cspStyle", "cspEval", "cspWasm",
    "storageUnavailable", "webglUnavailable",
]);
const mapCSPDiagnosticCodes = new Set(["cspScript", "cspWorker", "cspConnect", "cspImage", "cspStyle", "cspEval", "cspWasm"]);
const mapCSPResourceCodes = new Set([
    "blob", "data", "inline", "eval", "wasm", "other",
    "owner-origin", "local-address", "redacted",
]);
const isMapCSPResource = (value: unknown): value is string => {
    if (typeof value !== "string" || value.length > 102) return false;
    if (mapCSPResourceCodes.has(value)) return true;
    return value === "https:tiles.openfreemap.org" || value === "http:tiles.openfreemap.org";
};
const logMapDiagnostic = (code: unknown, resource?: unknown) => {
    if (typeof code === "string" && mapDiagnosticCodes.has(code)) {
        if (resource === undefined) {
            console.warn("Database map diagnostic:", code);
        } else if (mapCSPDiagnosticCodes.has(code) && isMapCSPResource(resource)) {
            console.warn("Database map diagnostic:", code, resource);
        }
    }
};

type DesktopMapCreation = {mode: "webview"; src: string; partition: string};

// 主进程只可返回固定地图文档和临时分区；不接受通用 webview 属性或其他导航目标。
export const parseDesktopMapCreation = (value: unknown, instanceID: string, origin: string): DesktopMapCreation | undefined => {
    if (!/^[a-f0-9]{48}$/.test(instanceID) || !value || typeof value !== "object" || Array.isArray(value)) return;
    const reply = value as Record<string, unknown>;
    if (reply.version !== AV_MAP_PROTOCOL_VERSION || reply.instanceID !== instanceID) return;
    const keys = Object.keys(reply);
    if (reply.mode !== "webview" || keys.length !== 5 || typeof reply.src !== "string" ||
        typeof reply.partition !== "string" || !/^siyuan-map-[a-f0-9]{48}$/.test(reply.partition)) return;
    let owner: URL;
    try { owner = new URL(origin); } catch (_error) { return; }
    if (!/^https?:$/.test(owner.protocol) || owner.origin !== origin) return;
    const prefix = `${origin}/stage/map/index.html?provider=openfreemap#${instanceID}:`;
    if (!reply.src.startsWith(prefix) || !/^[a-f0-9]{48}$/.test(reply.src.substring(prefix.length))) return;
    return {mode: "webview", src: reply.src, partition: reply.partition};
};

export const isDesktopAVMapHostSupported = async (): Promise<boolean> => {
    const ipc = getIPC();
    if (!ipc) {
        return false;
    }
    try {
        const reply = await ipc.invoke("siyuan-map-capability");
        if (reply?.version === AV_MAP_PROTOCOL_VERSION && reply.supported === true) {
            return true;
        }
        // 主进程返回值也仅按固定码记录，避免日志输出任意异常、URL 或凭据。
        const reason = reply?.version === AV_MAP_PROTOCOL_VERSION && capabilityFailureReasons.has(reply.reason) ?
            reply.reason : "unsupportedCapability";
        console.warn("Database map host unavailable:", reason);
    } catch (_error) {
        console.warn("Database map host unavailable:", "capabilityUnavailable");
    }
    return false;
};

export const createDesktopAVMapHost = (container: HTMLElement, options: AVMapHostOptions): AVMapHost => {
    const scope = container.ownerDocument.defaultView;
    const ipc = getIPC();
    let destroyed = false, ready = false, created = false, pendingReady = false;
    let webview: HTMLElement;
    let instanceID = "", revision = -1, theme = options.theme;
    let points: AVMapPoint[] = [];
    let ids = new Set<string>();
    let frame = 0, timeout = 0;
    let lastVisibility = "";
    const diagnostics = new Set<string>();
    let resizeObserver: ResizeObserver;
    const envelope = () => ({version: AV_MAP_PROTOCOL_VERSION, instanceID} as const);
    const send = (command: AVMapCommand) => {
        if (!destroyed && ready) {
            ipc.send("siyuan-map-command", command);
        }
    };
    const updateVisibility = () => {
        if (destroyed) return;
        const next = ready ? getAVMapVisibility(container) : {visible: false};
        const key = JSON.stringify(next);
        if (key !== lastVisibility) {
            lastVisibility = key;
            send({...envelope(), type: "visibility", ...next});
        }
    };
    const invalidate = () => {
        if (!destroyed && scope) {
            updateVisibility();
            send({...envelope(), type: "resize"});
        }
    };
    const tick = () => {
        if (destroyed) {
            return;
        }
        updateVisibility();
        frame = scope.requestAnimationFrame(tick);
    };
    const destroy = () => {
        if (destroyed) {
            return;
        }
        destroyed = true;
        ready = false;
        if (instanceID) {
            ipc?.send("siyuan-map-destroy", envelope());
        }
        ipc?.removeListener("siyuan-map-reply", onReply);
        scope?.clearTimeout(timeout);
        scope?.cancelAnimationFrame(frame);
        scope?.removeEventListener("pagehide", destroy);
        scope?.removeEventListener("scroll", updateVisibility, true);
        scope?.removeEventListener("resize", invalidate);
        scope?.removeEventListener("focus", updateVisibility);
        container.ownerDocument.removeEventListener("visibilitychange", invalidate);
        resizeObserver?.disconnect();
        webview?.remove();
        points = [];
        ids.clear();
    };
    const fail = (code: AVMapErrorCode) => {
        if (!destroyed) {
            console.warn("Database map failed:", code);
            destroy();
            options.onError(code);
        }
    };
    const postPoints = () => {
        if (revision >= 0) {
            send({...envelope(), type: "setPoints", points, revision});
        }
    };
    const onReply = (_event: unknown, value: unknown) => {
        if (destroyed) {
            return;
        }
        const diagnostic = value as {version?: unknown; instanceID?: unknown; type?: unknown; code?: unknown; resource?: unknown};
        if (ready && diagnostic?.version === AV_MAP_PROTOCOL_VERSION &&
            diagnostic.instanceID === instanceID && diagnostic.type === "dismissMenu") {
            if (Object.keys(diagnostic).length === 3 && getAVMapVisibility(container).visible) {
                // 只消费主进程由真实 guest 鼠标输入产生的固定信号，不合成编辑器事件。
                window.siyuan.menus.menu.remove();
            }
            return;
        }
        if (diagnostic?.version === AV_MAP_PROTOCOL_VERSION && diagnostic.instanceID === instanceID && diagnostic.type === "diagnostic") {
            if (typeof diagnostic.code !== "string" || !mapDiagnosticCodes.has(diagnostic.code) ||
                diagnostic.resource !== undefined && (!mapCSPDiagnosticCodes.has(diagnostic.code) ||
                    !isMapCSPResource(diagnostic.resource))) return;
            const key = diagnostic.code + ":" + (diagnostic.resource || "");
            if (diagnostics.has(key) || diagnostics.size >= 64) return;
            diagnostics.add(key);
            logMapDiagnostic(diagnostic.code, diagnostic.resource);
            return;
        }
        const reply = parseAVMapReply(value, instanceID);
        if (reply?.type === "ready" && !ready) {
            if (!created) {
                pendingReady = true;
                return;
            }
            ready = true;
            scope.clearTimeout(timeout);
            postPoints();
            send({...envelope(), type: "theme", theme});
            lastVisibility = "";
            updateVisibility();
            options.onReady?.();
        } else if (reply?.type === "markerClick" && ready && reply.revision === revision && ids.has(reply.id)) {
            options.onMarkerClick(reply.id, reply.revision);
        } else if (reply?.type === "attributionClick" && ready) {
            // 主进程已校验 guest 可见区域，并消费一次可信用户输入。
            options.onAttributionClick?.(reply.link);
        } else if (reply?.type === "error") {
            fail(reply.code);
        }
    };
    const host: AVMapHost = {
        setPoints: (input, nextRevision) => {
            if (!destroyed && isAVMapRevision(nextRevision) && nextRevision > revision) {
                revision = nextRevision;
                points = sanitizeAVMapPoints(input);
                ids = new Set(points.map((point) => point.id));
                postPoints();
            }
        },
        resize: invalidate,
        setTheme: (nextTheme) => {
            if (!destroyed && isAVMapTheme(nextTheme)) {
                theme = nextTheme;
                send({...envelope(), type: "theme", theme});
            }
        },
        destroy,
    };
    if (!scope || !ipc) {
        queueMicrotask(() => fail("unsupportedEnvironment"));
        return host;
    }
    if (!isAVMapProvider(options.provider) || !isAVMapTheme(options.theme)) {
        queueMicrotask(() => fail("invalidConfiguration"));
        return host;
    }
    const start = async () => {
        const bytes = new Uint8Array(24);
        scope.crypto.getRandomValues(bytes);
        instanceID = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
        ipc.on("siyuan-map-reply", onReply);
        scope.addEventListener("pagehide", destroy, {once: true});
        // 主进程分别限制资源准备与地图就绪；此预算只处理主进程或 IPC 未能返回结果的情况。
        timeout = scope.setTimeout(() => fail("hostReadyTimeout"), AV_MAP_OWNER_TIMEOUT);
        let reply: {version?: number; instanceID?: string; error?: unknown; diagnostic?: unknown};
        try {
            reply = await ipc.invoke("siyuan-map-create", {...envelope(), provider: options.provider, theme});
        } catch (_error) {
            fail("hostCreateRejected");
            return;
        }
        // 创建可能在销毁后才完成；再次通知主进程，覆盖第一次销毁早于创建的情况。
        if (destroyed) {
            ipc.send("siyuan-map-destroy", envelope());
            return;
        }
        if (reply?.version !== AV_MAP_PROTOCOL_VERSION || reply.instanceID !== instanceID) {
            fail("hostCreateInvalidResponse");
            return;
        }
        if (reply.error) {
            logMapDiagnostic(reply?.diagnostic);
            fail(reply.error === "unsupportedEnvironment" ? "unsupportedEnvironment" :
                isAVMapHostErrorCode(reply.error) ? reply.error : "hostCreateInvalidResponse");
            return;
        }
        const creation = parseDesktopMapCreation(reply, instanceID, scope.location?.origin || "");
        if (!creation) {
            fail("hostCreateInvalidResponse");
            return;
        }
        created = true;
        webview = container.ownerDocument.createElement("webview");
        webview.setAttribute("title", options.title || "");
        webview.style.cssText = "width:100%;height:100%;border:0;display:flex";
        // 分区必须在 src 和连接 DOM 之前指定，主进程再次校验并强制安全偏好。
        webview.setAttribute("partition", creation.partition);
        webview.setAttribute("src", creation.src);
        container.append(webview);
        scope.addEventListener("scroll", updateVisibility, true);
        scope.addEventListener("resize", invalidate);
        scope.addEventListener("focus", updateVisibility);
        container.ownerDocument.addEventListener("visibilitychange", invalidate);
        resizeObserver = new ResizeObserver(invalidate);
        resizeObserver.observe(container);
        if (pendingReady) onReply(undefined, {...envelope(), type: "ready"});
        tick();
    };
    void start().catch(() => fail("hostOwnerSetupFailed"));
    return host;
};
