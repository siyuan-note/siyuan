import {
    AV_MAP_PROTOCOL_VERSION, AVMapErrorCode, AVMapInit, AVMapReply, getAVMapLoadErrorCode, isAVMapAttributionLink, isAVMapHandshake, isAVMapProvider,
    parseAVMapCommand,
} from "./protocol";
import {AVMapAdapter, AVMapAdapterCallbacks} from "./providers";
import {loadAVMapAdapter} from "./providersLoader";
import {prepareAVMapBootstrap} from "./bootstrap";
import {isAVMapBootstrapMessage} from "./hostCapabilities";

export type AVMapAdapterFactory = (init: AVMapInit, container: HTMLElement,
    callbacks: AVMapAdapterCallbacks, signal: AbortSignal) => Promise<AVMapAdapter>;

export const isAVMapRuntimeIsolated = (scope: Window, nativeBoundary = false): boolean => {
    const environment = scope as unknown as Record<string, any>;
    if (scope.origin !== "null" || environment.require || environment.process || (!nativeBoundary &&
        (environment.JSAndroid || environment.Android || environment.JSHarmony || environment.Harmony ||
            environment.webkit?.messageHandlers))) {
        return false;
    }
    try {
        // 无法读取父文档是最低运行门槛；桌面关闭 webSecurity 的环境不会获准加载 SDK。
        void scope.parent.document;
        return false;
    } catch (_error) {
        return true;
    }
};

export const startAVMapRuntime = (port: MessagePort, instanceID: string, provider: AVMapInit["provider"],
                                  container: HTMLElement, factory: AVMapAdapterFactory = loadAVMapAdapter) => {
    let destroyed = false;
    let initializing = false;
    let adapter: AVMapAdapter;
    let revision = -1;
    let initiallyFitted = false;
    let ids = new Set<string>();
    const abort = new AbortController();
    const envelope = {version: AV_MAP_PROTOCOL_VERSION, instanceID} as const;
    const send = (reply: AVMapReply) => {
        if (!destroyed) {
            port.postMessage(reply);
        }
    };
    const destroy = () => {
        if (destroyed) {
            return;
        }
        destroyed = true;
        abort.abort();
        ids.clear();
        port.onmessage = null;
        port.close();
        adapter?.destroy();
    };
    const fail = (code: AVMapErrorCode) => {
        send({...envelope, type: "error", code});
        destroy();
    };
    port.onmessage = async (event) => {
        if (destroyed) {
            return;
        }
        const command = parseAVMapCommand(event.data, instanceID, provider);
        if (!command) {
            return;
        }
        if (command.type === "destroy") {
            destroy();
            return;
        }
        try {
            if (command.type === "init") {
                if (initializing || adapter || command.provider !== provider) {
                    return;
                }
                initializing = true;
                const next = await factory(command, container, {
                    onMarkerClick: (id, clickedRevision) => {
                        if (clickedRevision === revision && ids.has(id)) {
                            send({...envelope, type: "markerClick", id, revision});
                        }
                    },
                    onError: fail,
                    onAttributionClick: link => {
                        if (adapter && isAVMapAttributionLink(link)) {
                            send({...envelope, type: "attributionClick", link});
                        }
                    },
                }, abort.signal);
                if (destroyed) {
                    next.destroy();
                    return;
                }
                adapter = next;
                adapter.setTheme(command.theme);
                send({...envelope, type: "ready"});
            } else if (adapter && command.type === "setPoints" && command.revision > revision) {
                revision = command.revision;
                ids = new Set(command.points.map((point) => point.id));
                adapter.setPoints(command.points, revision);
                if (!initiallyFitted && command.points.length > 0) {
                    adapter.fit();
                    initiallyFitted = true;
                }
            } else if (adapter && command.type === "theme") {
                adapter.setTheme(command.theme);
            } else if (adapter && command.type === "fit") {
                adapter.fit();
            } else if (adapter && command.type === "resize") {
                adapter.resize();
            } else if (adapter && command.type === "visibility") {
                adapter.setVisible(command.visible, command.viewport);
            }
        } catch (error) {
            fail(getAVMapLoadErrorCode(error) || (adapter ? "mapUnavailable" : "sdkUnavailable"));
        }
    };
    port.start();
    return destroy;
};

export const connectAVMapRuntime = (scope: Window) => {
    const [instanceID, nonce] = scope.location.hash.slice(1).split(":");
    const provider = new URLSearchParams(scope.location.search).get("provider");
    if (!/^[a-f0-9]{48}$/.test(instanceID || "") || !/^[a-f0-9]{48}$/.test(nonce || "") ||
        !isAVMapProvider(provider)) {
        return;
    }
    const environment = scope as unknown as Record<string, any>;
    const desktop = scope.parent === scope && environment.siyuanMapDesktop?.version === 1 &&
        !environment.require && !environment.process;
    // 此检查仅准许等待可信 wrapper 的无秘密 prepare，尚未准许加载 SDK。
    if (!desktop && (scope.parent === scope || !isAVMapRuntimeIsolated(scope, true))) {
        return;
    }
    let destroy: () => void;
    let destroyAssets: () => void;
    let preparing = false;
    let locked = false;
    let connected = false;
    let closed = false;
    let desktopPort: MessagePort;
    const abort = new AbortController();
    const envelope = {version: AV_MAP_PROTOCOL_VERSION, instanceID, nonce};
    const cleanup = () => {
        if (closed) {
            return;
        }
        closed = true;
        abort.abort();
        scope.removeEventListener("message", onConnect);
        scope.clearTimeout(timer);
        destroy?.();
        desktopPort?.close();
        destroyAssets?.();
    };
    const prepare = async () => {
        preparing = true;
        try {
            const dispose = await prepareAVMapBootstrap(scope, provider, abort.signal);
            if (closed) {
                dispose();
                return;
            }
            destroyAssets = dispose;
            locked = true;
            if (desktop) {
                scope.removeEventListener("message", onConnect);
                scope.clearTimeout(timer);
                destroy = startAVMapRuntime(desktopPort, instanceID, provider, scope.document.getElementById("map"));
                desktopPort.postMessage({version: AV_MAP_PROTOCOL_VERSION, type: "bootstrapReady", instanceID});
            } else {
                scope.parent.postMessage({...envelope, type: "bootstrapReady"}, "*");
            }
        } catch (_error) {
            if (!closed) {
                if (desktop) {
                    desktopPort?.postMessage({version: AV_MAP_PROTOCOL_VERSION, type: "error", instanceID, code: "hostUnavailable"});
                } else {
                    scope.parent.postMessage({...envelope, type: "bootstrapError"}, "*");
                }
            }
            cleanup();
        }
    };
    const onConnect = (event: MessageEvent) => {
        if (closed || connected) {
            return;
        }
        if (desktop) {
            if (!preparing && event.source === scope && event.ports.length === 1 && event.data?.provider === provider &&
                isAVMapBootstrapMessage(event.data, "siyuan-map-desktop-connect", instanceID, nonce)) {
                desktopPort = event.ports[0];
                connected = true;
                void prepare();
            }
            return;
        }
        if (event.source !== scope.parent) {
            return;
        }
        if (!preparing && event.ports.length === 0 &&
            isAVMapBootstrapMessage(event.data, "prepare", instanceID, nonce)) {
            if (!isAVMapRuntimeIsolated(scope, event.data.nativeBoundary === true)) {
                scope.parent.postMessage({...envelope, type: "bootstrapError"}, "*");
                cleanup();
                return;
            }
            void prepare();
            return;
        }
        if (!locked || event.ports.length !== 1 || !isAVMapHandshake(event.data, "connect", instanceID, nonce)) {
            return;
        }
        connected = true;
        scope.removeEventListener("message", onConnect);
        scope.clearTimeout(timer);
        destroy = startAVMapRuntime(event.ports[0], instanceID, provider, scope.document.getElementById("map"));
    };
    const timer = scope.setTimeout(cleanup, 30000);
    scope.addEventListener("message", onConnect);
    scope.addEventListener("pagehide", cleanup, {once: true});
    if (!desktop) {
        scope.parent.postMessage({...envelope, type: "hello"}, "*");
    }
};
