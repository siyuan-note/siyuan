import {
    AV_MAP_PROTOCOL_VERSION, AVMapCommand, AVMapCredentials, AVMapErrorCode, AVMapPoint, AVMapProvider, AVMapTheme,
    isAVMapProvider, isAVMapRevision, isAVMapTheme, parseAVMapReply,
    sanitizeAVMapCredentials, sanitizeAVMapPoints,
} from "./protocol";
import {getAVMapHostCapabilities, isAVMapBootstrapMessage} from "./hostCapabilities";

export interface AVMapHostOptions {
    provider: AVMapProvider;
    credentials?: AVMapCredentials;
    theme: AVMapTheme;
    title?: string;
    onReady?: () => void;
    onMarkerClick: (id: string, revision: number) => void;
    onError: (code: AVMapErrorCode) => void;
}

export interface AVMapHost {
    setPoints: (points: AVMapPoint[], revision: number) => void;
    fit: () => void;
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
    let pendingFit = false;
    let instanceID = "";
    let nonce = "";
    let nativeBoundary = false;
    let preparing = false;

    const send = (command: AVMapCommand) => {
        if (!destroyed && port) {
            port.postMessage(command);
        }
    };
    const envelope = () => ({version: AV_MAP_PROTOCOL_VERSION, instanceID} as const);
    const destroy = () => {
        if (destroyed) {
            return;
        }
        send({...envelope(), type: "destroy"});
        destroyed = true;
        ready = false;
        scope?.clearTimeout(timeout);
        scope?.removeEventListener("message", onMessage);
        scope?.removeEventListener("pagehide", destroy);
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
            fail("hostUnavailable");
            return;
        }
        if (!preparing || !isAVMapBootstrapMessage(event.data, "bootstrapReady", instanceID, nonce)) {
            return;
        }
        scope.removeEventListener("message", onMessage);
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
        port.start();
        iframe.contentWindow.postMessage({...envelope(), type: "connect", nonce}, scope.location.origin, [channel.port2]);
        // 端口建立后清除全局监听；外部 SDK 加载期间不再接受窗口消息。
        send({...envelope(), type: "init", provider: options.provider,
            credentials: sanitizeAVMapCredentials(options.credentials, options.provider), theme});
    };

    const host: AVMapHost = {
        setPoints: (input, nextRevision) => {
            if (destroyed || !isAVMapRevision(nextRevision) || nextRevision <= revision) {
                return;
            }
            revision = nextRevision;
            points = sanitizeAVMapPoints(input, options.provider);
            ids = new Set(points.map((point) => point.id));
            postPoints();
        },
        fit: () => {
            if (ready) {
                send({...envelope(), type: "fit"});
            } else {
                pendingFit = true;
            }
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
        iframe.addEventListener("error", () => fail("hostUnavailable"), {once: true});
        scope.addEventListener("message", onMessage);
        scope.addEventListener("pagehide", destroy, {once: true});
        timeout = scope.setTimeout(() => fail("hostUnavailable"), 30000);
        container.appendChild(iframe);
        if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(host.resize);
            observer.observe(container);
        }
    };
    void start().catch(() => fail("hostUnavailable"));
    return host;
};
