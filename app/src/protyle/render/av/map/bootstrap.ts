import {AVMapProvider, isAVMapProvider} from "./protocol";
import {prepareAVMapAssets} from "./providersLoader";

// 此策略与响应策略共同生效，在创建 Worker 前移除本地来源权限。
export const getAVMapLockedPolicy = (provider: AVMapProvider): string => {
    if (!isAVMapProvider(provider)) throw new Error("invalidConfiguration");
    return "default-src 'none'; script-src 'none'; connect-src https://tiles.openfreemap.org; " +
        "img-src data: blob: https://tiles.openfreemap.org; " +
        "style-src 'unsafe-inline'; font-src 'none'; worker-src blob:; child-src blob:; " +
        "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
};

export const prepareAVMapBootstrap = async (scope: Window, provider: AVMapProvider, signal: AbortSignal): Promise<() => void> => {
    const assets = await prepareAVMapAssets(scope, provider, signal);
    try {
        if (signal.aborted) throw new Error("hostUnavailable");
        const policy = scope.document.createElement("meta");
        policy.httpEquiv = "Content-Security-Policy";
        policy.content = getAVMapLockedPolicy(provider);
        scope.document.head.appendChild(policy);
        assets.lock();
        return assets.destroy;
    } catch (_error) {
        assets.destroy();
        throw new Error("hostUnavailable");
    }
};
