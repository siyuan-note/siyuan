/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import type {AVMapHost, AVMapHostOptions} from "./host";
import {
    AV_MAP_PROTOCOL_VERSION, AVMapCommand, AVMapErrorCode, AVMapPoint, isAVMapHostErrorCode, isAVMapProvider, isAVMapRevision,
    isAVMapTheme, parseAVMapReply, sanitizeAVMapCredentials, sanitizeAVMapPoints,
} from "./protocol";

interface MapRect { x: number; y: number; width: number; height: number; }
type MapGeometry = {visible: false} | {
    visible: true; bounds: MapRect; logicalSize: {width: number; height: number}; crop: {x: number; y: number};
};

const intersects = (a: MapRect, b: MapRect) => a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;

// All coordinates stay in owner CSS pixels. Only the main process applies the owner zoom factor.
export const computeDesktopAVMapGeometry = (rect: MapRect, clips: MapRect[], occluders: MapRect[] = []): MapGeometry => {
    if (![rect, ...clips, ...occluders].every((item) => [item.x, item.y, item.width, item.height].every(Number.isFinite) &&
        item.width >= 0 && item.height >= 0) || rect.width < 1 || rect.height < 1) {
        return {visible: false};
    }
    let left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height;
    clips.forEach((clip) => {
        left = Math.max(left, clip.x);
        top = Math.max(top, clip.y);
        right = Math.min(right, clip.x + clip.width);
        bottom = Math.min(bottom, clip.y + clip.height);
    });
    const bounds = {x: left, y: top, width: right - left, height: bottom - top};
    if (left < 0 || top < 0 || bounds.width < 1 || bounds.height < 1 ||
        occluders.some((item) => item.width > 0 && item.height > 0 && intersects(bounds, item))) {
        return {visible: false};
    }
    return {visible: true, bounds, logicalSize: {width: rect.width, height: rect.height},
        crop: {x: left - rect.x, y: top - rect.y}};
};

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
    "storageUnavailable", "webglUnavailable", "amapInvalidKey", "amapInvalidSecurityCode",
    "amapDomainMismatch", "amapPlatformMismatch",
]);
const mapCSPDiagnosticCodes = new Set(["cspScript", "cspWorker", "cspConnect", "cspImage", "cspStyle", "cspEval", "cspWasm"]);
const mapCSPResourceCodes = new Set([
    "blob", "data", "inline", "eval", "wasm", "other",
    "https:webapi.amap.com", "https:restapi.amap.com", "https:vdata.amap.com", "https:a.amap.com",
    "https:g.alicdn.com", "https:fourier.taobao.com", "https:autonavi-tile", "https:other",
    "http:webapi.amap.com", "http:restapi.amap.com", "http:vdata.amap.com", "http:a.amap.com",
    "http:g.alicdn.com", "http:fourier.taobao.com", "http:autonavi-tile", "http:other",
]);
const logMapDiagnostic = (code: unknown, resource?: unknown) => {
    if (typeof code === "string" && mapDiagnosticCodes.has(code)) {
        if (resource === undefined) {
            console.warn("Database map diagnostic:", code);
        } else if (mapCSPDiagnosticCodes.has(code) && typeof resource === "string" && mapCSPResourceCodes.has(resource)) {
            console.warn("Database map diagnostic:", code, resource);
        }
    }
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

const readGeometry = (container: HTMLElement): MapGeometry => {
    const doc = container.ownerDocument;
    const scope = doc.defaultView;
    if (!scope || doc.hidden || !container.isConnected || !container.getClientRects().length) {
        return {visible: false};
    }
    const rect = container.getBoundingClientRect();
    const clips: MapRect[] = [{x: 0, y: 0, width: scope.innerWidth, height: scope.innerHeight}];
    for (let element: HTMLElement = container; element; element = element.parentElement) {
        const style = scope.getComputedStyle(element);
        if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0 ||
            style.getPropertyValue("content-visibility") === "hidden") {
            return {visible: false};
        }
        if (element !== container && /hidden|clip|scroll|auto/.test(style.overflowX + style.overflowY)) {
            const bounds = element.getBoundingClientRect();
            const clipX = /hidden|clip|scroll|auto/.test(style.overflowX);
            const clipY = /hidden|clip|scroll|auto/.test(style.overflowY);
            const scaleX = element.offsetWidth ? bounds.width / element.offsetWidth : 1;
            const scaleY = element.offsetHeight ? bounds.height / element.offsetHeight : 1;
            clips.push({x: clipX ? bounds.x + element.clientLeft * scaleX : 0,
                y: clipY ? bounds.y + element.clientTop * scaleY : 0,
                width: clipX ? element.clientWidth * scaleX : scope.innerWidth,
                height: clipY ? element.clientHeight * scaleY : scope.innerHeight});
        }
    }
    const views = container.closest(".av[data-type='NodeAttributeView']")
        ?.querySelector<HTMLElement>(":scope > .av__container > .av__header > .av__views--fixed");
    if (views?.getClientRects().length) {
        const style = scope.getComputedStyle(views);
        const bounds = views.getBoundingClientRect();
        if (["fixed", "sticky"].includes(style.position) && style.display !== "none" &&
            style.visibility === "visible" && Number(style.opacity) !== 0 && intersects(rect, bounds)) {
            // 本数据库的固定页签栏遮住地图顶部时，只展示栏底部以下的区域。
            const top = Math.max(0, bounds.y + bounds.height);
            clips.push({x: 0, y: top, width: scope.innerWidth, height: Math.max(0, scope.innerHeight - top)});
        }
    }
    const occluders: MapRect[] = [];
    // These are actual application overlay roots, not guesses based on arbitrary z-index values.
    doc.querySelectorAll<HTMLElement>(".b3-menu, .b3-dialog, .av__panel, .protyle-util, .protyle-toolbar, .block__popover, [popover]")
        .forEach((element) => {
            if (element.contains(container) || !element.getClientRects().length) {
                return;
            }
            const style = scope.getComputedStyle(element);
            if (style.display !== "none" && style.visibility === "visible" && Number(style.opacity) !== 0) {
                occluders.push(element.getBoundingClientRect());
            }
        });
    const geometry = computeDesktopAVMapGeometry(rect, clips, occluders);
    if (geometry.visible) {
        const bounds = geometry.bounds;
        // Hit-test the owner's DOM (native child views are not in this tree), including sticky toolbars.
        for (const x of [bounds.x + 0.5, bounds.x + bounds.width / 2, bounds.x + bounds.width - 0.5]) {
            for (const y of [bounds.y + 0.5, bounds.y + bounds.height / 2, bounds.y + bounds.height - 0.5]) {
                const top = doc.elementFromPoint(x, y);
                if (!top || !container.contains(top)) {
                    return {visible: false};
                }
            }
        }
    }
    return geometry;
};

export const createDesktopAVMapHost = (container: HTMLElement, options: AVMapHostOptions): AVMapHost => {
    const scope = container.ownerDocument.defaultView;
    const ipc = getIPC();
    let destroyed = false, ready = false, created = false, pendingFit = false;
    let instanceID = "", revision = -1, theme = options.theme;
    let points: AVMapPoint[] = [];
    let ids = new Set<string>();
    let frame = 0, timeout = 0, stableAfter = 0, scrollingUntil = 0;
    let lastGeometry = "", sentGeometry = "";
    let observer: MutationObserver;
    let resizeObserver: ResizeObserver;
    const envelope = () => ({version: AV_MAP_PROTOCOL_VERSION, instanceID} as const);
    const send = (command: AVMapCommand) => {
        if (!destroyed && ready) {
            ipc.send("siyuan-map-command", command);
        }
    };
    const geometry = (value: MapGeometry) => {
        const key = JSON.stringify(value);
        if (created && key !== sentGeometry) {
            ipc.send("siyuan-map-geometry", {...envelope(), ...value});
            sentGeometry = key;
        }
    };
    const invalidate = () => {
        if (!destroyed && scope) {
            stableAfter = scope.performance.now() + 120;
            geometry({visible: false});
        }
    };
    const checkGeometry = () => {
        const next = readGeometry(container);
        const key = JSON.stringify(next);
        if (key !== lastGeometry) {
            lastGeometry = key;
            if (scope.performance.now() < scrollingUntil) {
                stableAfter = 0;
                geometry(next);
            } else {
                invalidate();
            }
        }
        return next;
    };
    const onScroll = () => {
        if (!destroyed && scope) {
            // 滚动和同轮固定栏布局更新都使用完整遮挡检查后的最新裁剪，不等待滚动停止。
            scrollingUntil = scope.performance.now() + 120;
            stableAfter = 0;
            geometry(checkGeometry());
        }
    };
    const tick = () => {
        if (destroyed) {
            return;
        }
        const next = checkGeometry();
        if (!next.visible || scope.performance.now() >= stableAfter) {
            geometry(next);
        }
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
        scope?.removeEventListener("scroll", onScroll, true);
        scope?.removeEventListener("resize", invalidate);
        scope?.removeEventListener("focus", invalidate);
        container.ownerDocument.removeEventListener("visibilitychange", invalidate);
        observer?.disconnect();
        resizeObserver?.disconnect();
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
        if (diagnostic?.version === AV_MAP_PROTOCOL_VERSION && diagnostic.instanceID === instanceID && diagnostic.type === "diagnostic") {
            logMapDiagnostic(diagnostic.code, diagnostic.resource);
            return;
        }
        const reply = parseAVMapReply(value, instanceID);
        if (reply?.type === "ready" && !ready) {
            ready = true;
            scope.clearTimeout(timeout);
            postPoints();
            send({...envelope(), type: "theme", theme});
            if (pendingFit) {
                send({...envelope(), type: "fit"});
                pendingFit = false;
            }
            options.onReady?.();
        } else if (reply?.type === "markerClick" && ready && reply.revision === revision && ids.has(reply.id)) {
            options.onMarkerClick(reply.id, reply.revision);
        } else if (reply?.type === "error") {
            fail(reply.code);
        }
    };
    const host: AVMapHost = {
        setPoints: (input, nextRevision) => {
            if (!destroyed && isAVMapRevision(nextRevision) && nextRevision > revision) {
                revision = nextRevision;
                points = sanitizeAVMapPoints(input, options.provider);
                ids = new Set(points.map((point) => point.id));
                postPoints();
            }
        },
        fit: () => {
            if (!destroyed) {
                if (ready) { send({...envelope(), type: "fit"}); } else { pendingFit = true; }
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
        // 主进程先等待引导 30 秒，再为 SDK 两个 20 秒阶段保留 45 秒；这里只做更晚的失联兜底。
        timeout = scope.setTimeout(() => fail("hostReadyTimeout"), 90000);
        let reply: {version?: number; instanceID?: string; error?: unknown; diagnostic?: unknown};
        try {
            reply = await ipc.invoke("siyuan-map-create", {...envelope(), provider: options.provider,
                credentials: sanitizeAVMapCredentials(options.credentials, options.provider), theme});
        } catch (_error) {
            fail("hostCreateRejected");
            return;
        }
        // Creation can finish after disposal. Tell main again, even if the first destroy arrived too early.
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
        created = true;
        scope.addEventListener("scroll", onScroll, true);
        scope.addEventListener("resize", invalidate);
        // BrowserWindow focus is enforced in main. DOM blur also fires when the map view gains focus.
        scope.addEventListener("focus", invalidate);
        container.ownerDocument.addEventListener("visibilitychange", invalidate);
        observer = new MutationObserver(() => {
            // 悬停提示和块标也会改变 DOM；仅地图几何或遮挡变化需要隐藏原生视图。
            if (!destroyed) {
                checkGeometry();
            }
        });
        observer.observe(container.ownerDocument.documentElement, {childList: true, subtree: true,
            attributes: true, attributeFilter: ["class", "style", "hidden", "open"]});
        resizeObserver = new ResizeObserver(invalidate);
        resizeObserver.observe(container);
        tick();
    };
    void start().catch(() => fail("hostOwnerSetupFailed"));
    return host;
};
