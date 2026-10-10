import {
    AV_MAP_PROTOCOL_VERSION, AVMapAttributionLink, AVMapCommand, AVMapErrorCode, AVMapPoint, AVMapProvider, AVMapTheme, AVMapVisibility,
    isAVMapBootstrapMessage, isAVMapLoadErrorCode, isAVMapProvider, isAVMapRevision, isAVMapTheme, parseAVMapReply,
    sanitizeAVMapPoints,
} from "./protocol";
import {getAVMapHostCapabilities} from "./hostCapabilities";
import {AV_MAP_BOOTSTRAP_TIMEOUT, AV_MAP_HOST_READY_TIMEOUT} from "./loadingBudget";

export interface AVMapHostOptions {
    provider: AVMapProvider;
    theme: AVMapTheme;
    title?: string;
    onReady?: () => void;
    onMarkerClick: (id: string, revision: number) => void;
    onError: (code: AVMapErrorCode) => void;
    onAttributionClick?: (link: AVMapAttributionLink) => void;
}

export interface AVMapHost {
    setPoints: (points: AVMapPoint[], revision: number) => void;
    resize: () => void;
    setTheme: (theme: AVMapTheme) => void;
    destroy: () => void;
}

export const isAVMapHostEnvironmentSupported = async (scope: Window = window): Promise<boolean> =>
    (await getAVMapHostCapabilities(scope)).supported;

const randomID = (scope: Window): string => {
    const bytes = new Uint8Array(24);
    scope.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
};

// 将父页面裁剪区域换算为隔离 iframe 视口的 CSS 像素。
export const getAVMapVisibility = (container: HTMLElement): AVMapVisibility => {
    const doc = container.ownerDocument;
    const scope = doc.defaultView;
    const hidden = {visible: false};
    if (!scope || doc.hidden || !container.isConnected || !container.getClientRects().length) return hidden;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || container.clientWidth <= 0 || container.clientHeight <= 0) return hidden;
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    let right = Math.min(scope.innerWidth, rect.right), bottom = Math.min(scope.innerHeight, rect.bottom);
    for (let element = container; element; element = element.parentElement) {
        const style = scope.getComputedStyle(element);
        if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0 ||
            style.getPropertyValue("content-visibility") === "hidden") return hidden;
        if (element !== container) {
            const clip = element.getBoundingClientRect();
            const scaleX = element.offsetWidth ? clip.width / element.offsetWidth : 1;
            const scaleY = element.offsetHeight ? clip.height / element.offsetHeight : 1;
            if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
                const x = clip.left + element.clientLeft * scaleX;
                left = Math.max(left, x); right = Math.min(right, x + element.clientWidth * scaleX);
            }
            if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
                const y = clip.top + element.clientTop * scaleY;
                top = Math.max(top, y); bottom = Math.min(bottom, y + element.clientHeight * scaleY);
            }
        }
    }
    if (right - left < 2 || bottom - top < 2) return hidden;
    const hits = [left + 0.5, (left + right) / 2, right - 0.5].flatMap(x =>
        [top + 0.5, (top + bottom) / 2, bottom - 0.5].map(y => container.contains(doc.elementFromPoint(x, y))));
    if (!hits.some(Boolean)) return hidden;
    if (!hits.every(Boolean)) return {visible: true};
    // 内层无法命中检测父页面浮层；小浮层也可能遮住署名而避开上面的采样点。
    const overlays = doc.querySelectorAll<HTMLElement>(
        ".b3-menu, .b3-dialog, .av__panel, .protyle-util, .protyle-toolbar, .block__popover, [popover]");
    for (const overlay of Array.from(overlays)) {
        if (overlay.contains(container) || !overlay.getClientRects().length) continue;
        const style = scope.getComputedStyle(overlay);
        const bounds = overlay.getBoundingClientRect();
        if (style.display !== "none" && style.visibility === "visible" && Number(style.opacity) !== 0 &&
            bounds.width > 0 && bounds.height > 0 && bounds.left < right && bounds.right > left &&
            bounds.top < bottom && bounds.bottom > top) return {visible: true};
    }
    const scaleX = rect.width / container.clientWidth, scaleY = rect.height / container.clientHeight;
    return {visible: true, viewport: {x: (left - rect.left) / scaleX, y: (top - rect.top) / scaleY,
        width: (right - left) / scaleX, height: (bottom - top) / scaleY}};
};

export const createAVMapHost = (container: HTMLElement, options: AVMapHostOptions): AVMapHost => {
    const scope = container.ownerDocument.defaultView;
    let destroyed = false;
    let ready = false;
    let port: MessagePort;
    let iframe: HTMLIFrameElement;
    let timeout: number;
    let observer: ResizeObserver;
    let revision = -1;
    let points: AVMapPoint[] = [];
    let ids = new Set<string>();
    let theme = options.theme;
    let instanceID = "";
    let nonce = "";
    let nativeBoundary = false;
    let preparing = false;
    let frame = 0, visible = false, lastVisibility = "";

    const send = (command: AVMapCommand) => {
        if (!destroyed && port) {
            port.postMessage(command);
        }
    };
    const envelope = () => ({version: AV_MAP_PROTOCOL_VERSION, instanceID} as const);
    const updateVisibility = () => {
        const next = ready ? getAVMapVisibility(container) : {visible: false};
        const key = JSON.stringify(next);
        if (key !== lastVisibility) {
            visible = next.visible;
            lastVisibility = key;
            send({...envelope(), type: "visibility", ...next});
        }
    };
    const tickVisibility = () => {
        if (destroyed) return;
        updateVisibility();
        frame = scope.requestAnimationFrame(tickVisibility);
    };
    const destroy = () => {
        if (destroyed) {
            return;
        }
        send({...envelope(), type: "destroy"});
        destroyed = true;
        ready = false;
        scope?.clearTimeout(timeout);
        scope?.cancelAnimationFrame(frame);
        scope?.removeEventListener("message", onMessage);
        scope?.removeEventListener("pagehide", destroy);
        container.ownerDocument.removeEventListener("visibilitychange", updateVisibility);
        observer?.disconnect();
        if (port) {
            port.onmessage = null;
            port.close();
        }
        iframe?.remove();
        points = [];
        ids.clear();
    };
    const fail = (code: AVMapErrorCode) => {
        if (destroyed) {
            return;
        }
        destroy();
        options.onError(code);
    };
    const postPoints = () => {
        if (ready && revision >= 0) {
            send({...envelope(), type: "setPoints", points, revision});
        }
    };
    const onMessage = (event: MessageEvent) => {
        if (destroyed || port || event.source !== iframe?.contentWindow || event.origin !== scope.location.origin ||
            event.ports.length !== 0) {
            return;
        }
        if (!preparing && isAVMapBootstrapMessage(event.data, "wrapperHello", instanceID, nonce)) {
            preparing = true;
            iframe.contentWindow.postMessage({...envelope(), type: "prepare", nonce, nativeBoundary}, scope.location.origin);
            return;
        }
        if (preparing && isAVMapBootstrapMessage(event.data, "bootstrapError", instanceID, nonce)) {
            fail(isAVMapLoadErrorCode(event.data.code) ? event.data.code : "hostBootstrapFailed");
            return;
        }
        if (!preparing || !isAVMapBootstrapMessage(event.data, "bootstrapReady", instanceID, nonce)) {
            return;
        }
        scope.removeEventListener("message", onMessage);
        // 打包资源和 CSP 已准备完成；此预算仅保护后续地图创建与 load 就绪。
        scope.clearTimeout(timeout);
        timeout = scope.setTimeout(() => fail("hostSDKTimeout"), AV_MAP_HOST_READY_TIMEOUT);
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = (replyEvent) => {
            if (destroyed) {
                return;
            }
            const reply = parseAVMapReply(replyEvent.data, instanceID);
            if (reply?.type === "ready" && !ready) {
                ready = true;
                scope.clearTimeout(timeout);
                postPoints();
                send({...envelope(), type: "theme", theme});
                options.onReady?.();
                tickVisibility();
            } else if (reply?.type === "markerClick" && ready && reply.revision === revision && ids.has(reply.id)) {
                options.onMarkerClick(reply.id, reply.revision);
            } else if (reply?.type === "attributionClick" && ready && visible &&
                getAVMapVisibility(container).visible &&
                (scope.navigator as Navigator & {userActivation?: {isActive: boolean}}).userActivation?.isActive) {
                options.onAttributionClick?.(reply.link);
            } else if (reply?.type === "error") {
                fail(reply.code);
            }
        };
        port.start();
        iframe.contentWindow.postMessage({...envelope(), type: "connect", nonce}, scope.location.origin, [channel.port2]);
        // 端口建立后清除全局监听；地图初始化期间不再接受窗口消息。
        send({...envelope(), type: "init", provider: options.provider, theme});
    };

    const host: AVMapHost = {
        setPoints: (input, nextRevision) => {
            if (destroyed || !isAVMapRevision(nextRevision) || nextRevision <= revision) {
                return;
            }
            revision = nextRevision;
            points = sanitizeAVMapPoints(input);
            ids = new Set(points.map((point) => point.id));
            postPoints();
        },
        resize: () => {
            if (ready) {
                send({...envelope(), type: "resize"});
            }
        },
        setTheme: (nextTheme) => {
            if (!isAVMapTheme(nextTheme)) {
                return;
            }
            theme = nextTheme;
            if (ready) {
                send({...envelope(), type: "theme", theme});
            }
        },
        destroy,
    };
    if (!scope) {
        queueMicrotask(() => fail("unsupportedEnvironment"));
        return host;
    }
    if (!isAVMapProvider(options.provider) || !isAVMapTheme(options.theme)) {
        queueMicrotask(() => fail("invalidConfiguration"));
        return host;
    }
    const start = async () => {
        const capabilities = await getAVMapHostCapabilities(scope);
        if (destroyed) {
            return;
        }
        if (!capabilities.supported) {
            fail("unsupportedEnvironment");
            return;
        }
        nativeBoundary = capabilities.nativeBoundary;
        instanceID = randomID(scope);
        nonce = randomID(scope);
        iframe = container.ownerDocument.createElement("iframe");
        if (capabilities.credentialless) {
            (iframe as HTMLIFrameElement & {credentialless: boolean}).credentialless = true;
        }
        // 此层只包含固定的可信本地代码；加载 SDK 的内层绝不获得 allow-same-origin。
        iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
        iframe.setAttribute("allow", "geolocation 'none'; camera 'none'; microphone 'none'; clipboard-read 'none'; clipboard-write 'none'");
        iframe.referrerPolicy = "no-referrer";
        iframe.title = options.title || "";
        iframe.style.cssText = "width:100%;height:100%;border:0;display:block";
        iframe.src = `/stage/map/wrapper.html?provider=${options.provider}#${instanceID}:${nonce}`;
        iframe.addEventListener("error", () => fail("hostDocumentLoadFailed"), {once: true});
        scope.addEventListener("message", onMessage);
        scope.addEventListener("pagehide", destroy, {once: true});
        container.ownerDocument.addEventListener("visibilitychange", updateVisibility);
        timeout = scope.setTimeout(() => fail("hostBootstrapTimeout"), AV_MAP_BOOTSTRAP_TIMEOUT);
        container.appendChild(iframe);
        if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(host.resize);
            observer.observe(container);
        }
    };
    void start().catch(() => fail("hostUnavailable"));
    return host;
};
