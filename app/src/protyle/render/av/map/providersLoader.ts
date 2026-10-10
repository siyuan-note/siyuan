import {AVMapInit, AVMapLoadError, AVMapLoadErrorCode, AVMapProvider, getAVMapLoadErrorCode, isAVMapProvider} from "./protocol";
import {AVMapAdapter, AVMapAdapterCallbacks, createAVMapAdapter} from "./providers";

interface AVMapPreparedAssets {
    locked: boolean;
    sdk?: any;
    workerSource?: string;
    workerURL?: string;
    destroy: () => void;
}

const preparedAssets = new WeakMap<Window, AVMapPreparedAssets>();

const loadAsset = (scope: Window, element: HTMLScriptElement | HTMLLinkElement, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
        let settled = false;
        const finish = (success: boolean) => {
            if (settled) return;
            settled = true;
            scope.clearTimeout(timer);
            element.onload = null;
            element.onerror = null;
            signal.removeEventListener("abort", abort);
            if (success) {
                resolve();
            } else {
                element.remove();
                reject(new Error("hostUnavailable"));
            }
        };
        const abort = () => finish(false);
        const timer = scope.setTimeout(abort, 20000);
        signal.addEventListener("abort", abort, {once: true});
        element.onload = () => finish(true);
        element.onerror = abort;
        try {
            if (signal.aborted) finish(false);
            else scope.document.head.appendChild(element);
        } catch (_error) {
            finish(false);
        }
    });

// Only packaged assets are prepared here; no Map, Worker or blob exists before CSP is locked.
export const prepareAVMapAssets = async (scope: Window, provider: AVMapProvider, signal: AbortSignal) => {
    if (!isAVMapProvider(provider) || preparedAssets.has(scope) || signal.aborted) {
        throw new Error("hostUnavailable");
    }
    const assets: AVMapPreparedAssets = {locked: false, destroy: () => {
        if (assets.workerURL) {
            URL.revokeObjectURL(assets.workerURL);
            assets.workerURL = undefined;
        }
        assets.workerSource = undefined;
        if (preparedAssets.get(scope) === assets) preparedAssets.delete(scope);
    }};
    preparedAssets.set(scope, assets);
    try {
        const stylesheet = scope.document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = "/stage/build/map/maplibre-gl.css";
        await loadAsset(scope, stylesheet, signal);
        const script = scope.document.createElement("script");
        script.src = "/stage/build/map/maplibre-gl.js";
        script.referrerPolicy = "no-referrer";
        script.async = true;
        await loadAsset(scope, script, signal);
        const response = await scope.fetch("/stage/build/map/maplibre-gl-csp-worker.js", {
            credentials: "omit", mode: "cors", cache: "no-store", referrerPolicy: "no-referrer", signal,
        });
        if (!response.ok) throw new Error("hostUnavailable");
        assets.workerSource = await response.text();
        assets.sdk = (scope as unknown as Record<string, any>).maplibregl;
        if (!assets.sdk || signal.aborted) throw new Error("hostUnavailable");
        return {lock: () => { assets.locked = true; }, destroy: assets.destroy};
    } catch (_error) {
        assets.destroy();
        throw new Error("hostUnavailable");
    }
};

export const loadAVMapAdapter = async (init: AVMapInit, container: HTMLElement,
                                     callbacks: AVMapAdapterCallbacks, signal: AbortSignal): Promise<AVMapAdapter> => {
    const scope = container.ownerDocument.defaultView;
    const assets = preparedAssets.get(scope);
    if (!isAVMapProvider(init.provider) || !assets?.locked || signal.aborted) {
        throw new Error("hostUnavailable");
    }
    try {
        // Worker and blob inherit the locked policy, with no local network authority.
        assets.workerURL = URL.createObjectURL(new Blob([assets.workerSource], {type: "text/javascript"}));
        assets.workerSource = undefined;
        const sdk = assets.sdk;
        sdk.setWorkerUrl(assets.workerURL);
        let adapter: AVMapAdapter;
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (success: boolean, code?: AVMapLoadErrorCode) => {
                if (settled) return;
                settled = true;
                scope.clearTimeout(timer);
                signal.removeEventListener("abort", abort);
                if (success) {
                    resolve();
                } else {
                    try {
                        adapter?.destroy();
                    } finally {
                        reject(code ? new AVMapLoadError(code) : new Error("mapUnavailable"));
                    }
                }
            };
            const abort = () => finish(false);
            const timer = scope.setTimeout(() => finish(false, "mapReadyTimeout"), 20000);
            signal.addEventListener("abort", abort, {once: true});
            try {
                adapter = createAVMapAdapter(init.provider, sdk, container, {...callbacks,
                    onReady: () => finish(true), onError: code => {
                        callbacks.onError(code);
                        finish(false);
                    }});
                if (signal.aborted) finish(false);
            } catch (_error) {
                finish(false, "mapCreationFailed");
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
    } catch (error) {
        assets.destroy();
        const code = getAVMapLoadErrorCode(error);
        if (code) throw new AVMapLoadError(code);
        throw new Error("sdkUnavailable");
    }
};
