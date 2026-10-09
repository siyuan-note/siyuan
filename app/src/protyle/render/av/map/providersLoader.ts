import {AVMapInit, AVMapProvider} from "./protocol";
import {AVMapAdapter, AVMapAdapterCallbacks, createAVMapAdapter} from "./providers";

const SDK_CALLBACK = "__siyuanMapSDKReady";

interface AVMapPreparedAssets {
    provider: AVMapProvider;
    locked: boolean;
    sdk?: any;
    workerSource?: string;
    workerURL?: string;
    destroy: () => void;
}

const preparedAssets = new WeakMap<Window, AVMapPreparedAssets>();

const loadScript = (scope: Window, source: string, signal: AbortSignal, callback = false): Promise<void> => {
    return new Promise((resolve, reject) => {
        const script = scope.document.createElement("script");
        const globals = scope as unknown as Record<string, any>;
        let settled = false;
        const finish = (success: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            scope.clearTimeout(timer);
            script.onload = null;
            script.onerror = null;
            signal.removeEventListener("abort", abort);
            if (callback) {
                delete globals[SDK_CALLBACK];
            }
            if (success) {
                resolve();
            } else {
                script.remove();
                reject(new Error("sdkUnavailable"));
            }
        };
        const abort = () => finish(false);
        const timer = scope.setTimeout(() => finish(false), 20000);
        signal.addEventListener("abort", abort, {once: true});
        if (callback) {
            globals[SDK_CALLBACK] = () => finish(true);
        } else {
            script.onload = () => finish(true);
        }
        script.onerror = () => finish(false);
        script.src = source;
        script.referrerPolicy = "strict-origin-when-cross-origin";
        script.async = true;
        if (signal.aborted) {
            finish(false);
        } else {
            scope.document.head.appendChild(script);
        }
    });
};

// 只准备固定无凭据资产，不构造 Map、Worker 或 blob；只有 bootstrap 可以推进锁定阶段。
export const prepareAVMapAssets = async (scope: Window, provider: AVMapProvider, signal: AbortSignal) => {
    if (preparedAssets.has(scope) || signal.aborted) {
        throw new Error("hostUnavailable");
    }
    const assets: AVMapPreparedAssets = {provider, locked: false, destroy: () => {
        if (assets.workerURL) {
            URL.revokeObjectURL(assets.workerURL);
            assets.workerURL = undefined;
        }
        assets.workerSource = undefined;
        if (preparedAssets.get(scope) === assets) {
            preparedAssets.delete(scope);
        }
    }};
    preparedAssets.set(scope, assets);
    try {
        if (provider === "openfreemap") {
            await new Promise<void>((resolve, reject) => {
                const stylesheet = scope.document.createElement("link");
                stylesheet.rel = "stylesheet";
                stylesheet.href = "/stage/build/map/maplibre-gl.css";
                let settled = false;
                const finish = (success: boolean) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    scope.clearTimeout(timer);
                    signal.removeEventListener("abort", abort);
                    stylesheet.onload = null;
                    stylesheet.onerror = null;
                    if (success) {
                        resolve();
                    } else {
                        stylesheet.remove();
                        reject(new Error("hostUnavailable"));
                    }
                };
                const abort = () => finish(false);
                const timer = scope.setTimeout(abort, 20000);
                signal.addEventListener("abort", abort, {once: true});
                stylesheet.onload = () => finish(true);
                stylesheet.onerror = abort;
                scope.document.head.appendChild(stylesheet);
                if (signal.aborted) {
                    finish(false);
                }
            });
            await loadScript(scope, "/stage/build/map/maplibre-gl.js", signal);
            const response = await scope.fetch("/stage/build/map/maplibre-gl-csp-worker.js", {
                credentials: "omit", mode: "cors", cache: "no-store", referrerPolicy: "no-referrer", signal,
            });
            if (!response.ok) {
                throw new Error("hostUnavailable");
            }
            assets.workerSource = await response.text();
            assets.sdk = (scope as unknown as Record<string, any>).maplibregl;
            if (!assets.sdk) {
                throw new Error("hostUnavailable");
            }
        }
        if (signal.aborted) {
            throw new Error("hostUnavailable");
        }
        return {lock: () => { assets.locked = true; }, destroy: assets.destroy};
    } catch (_error) {
        assets.destroy();
        throw new Error("hostUnavailable");
    }
};

export const loadAVMapAdapter = async (init: AVMapInit, container: HTMLElement,
                                     callbacks: AVMapAdapterCallbacks, signal: AbortSignal): Promise<AVMapAdapter> => {
    const scope = container.ownerDocument.defaultView;
    const globals = scope as unknown as Record<string, any>;
    const {provider, credentials} = init;
    const assets = preparedAssets.get(scope);
    if (!assets?.locked || assets.provider !== provider || signal.aborted) {
        throw new Error("hostUnavailable");
    }
    if (provider !== "openfreemap" && !credentials.apiKey || provider === "amap" && !credentials.securityCode) {
        throw new Error("missingCredentials");
    }
    try {
        let sdk: any;
        if (provider === "openfreemap") {
            // blob 与 Worker 的创建都晚于 CSP 锁定，不继承启动阶段的本地网络权限。
            assets.workerURL = URL.createObjectURL(new Blob([assets.workerSource], {type: "text/javascript"}));
            assets.workerSource = undefined;
            sdk = assets.sdk;
            sdk.setWorkerUrl(assets.workerURL);
        } else {
            const scriptURL = new URL(provider === "amap" ? "https://webapi.amap.com/maps" :
                provider === "tencent" ? "https://map.qq.com/api/gljs" : "https://api.map.baidu.com/api");
            scriptURL.searchParams.set("v", provider === "amap" ? "2.0" : provider === "tencent" ? "1.exp" : "4.0");
            scriptURL.searchParams.set(provider === "baidu" ? "ak" : "key", credentials.apiKey);
            scriptURL.searchParams.set("callback", SDK_CALLBACK);
            if (provider === "amap") {
                globals._AMapSecurityConfig = {securityJsCode: credentials.securityCode};
            }
            await loadScript(scope, scriptURL.href, signal, true);
            sdk = globals[provider === "amap" ? "AMap" : provider === "tencent" ? "TMap" : "BMap"];
        }
        if (signal.aborted || !sdk) {
            throw new Error("sdkUnavailable");
        }
        let adapter: AVMapAdapter;
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (success: boolean) => {
                if (settled) {
                    return;
                }
                settled = true;
                scope.clearTimeout(timer);
                signal.removeEventListener("abort", abort);
                if (success) {
                    resolve();
                } else {
                    try {
                        adapter?.destroy();
                    } finally {
                        reject(new Error("mapUnavailable"));
                    }
                }
            };
            const abort = () => finish(false);
            const timer = scope.setTimeout(abort, 20000);
            signal.addEventListener("abort", abort, {once: true});
            try {
                adapter = createAVMapAdapter(provider, sdk, container, {...callbacks,
                    onReady: () => finish(true), onError: (code) => {
                        callbacks.onError(code);
                        finish(false);
                    }}, {bd09: globals.BMAP_COORD_BD09, gcj02: globals.BMAP_COORD_GCJ02});
                if (signal.aborted) {
                    finish(false);
                }
            } catch (_error) {
                finish(false);
            }
        });
        const destroy = adapter.destroy;
        adapter.destroy = () => {
            try {
                destroy();
            } finally {
                assets.destroy();
            }
        };
        return adapter;
    } catch (_error) {
        assets.destroy();
        throw new Error("sdkUnavailable");
    }
};
