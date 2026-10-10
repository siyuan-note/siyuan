export interface AVMapHostCapabilities {
    supported: boolean;
    nativeBoundary: boolean;
    credentialless: boolean;
}

// 此报告仅代表壳已经安装桥接和导航防护，不代表 Cookie、网络或 DOM 隔离。
export const getAVMapHostCapabilities = async (scope: Window): Promise<AVMapHostCapabilities> => {
    const environment = scope as unknown as Record<string, any>;
    const credentialless = !!environment.HTMLIFrameElement &&
        "credentialless" in environment.HTMLIFrameElement.prototype;
    const unsupported = {supported: false, nativeBoundary: false, credentialless};
    if (!/^https?:$/.test(scope.location.protocol) || environment.require || environment.process ||
        /Electron/i.test(scope.navigator.userAgent) || !environment.HTMLIFrameElement) {
        return unsupported;
    }
    const native = !!(environment.webkit?.messageHandlers || environment.Android || environment.JSAndroid ||
        environment.Harmony || environment.JSHarmony || /SiYuan\/|SiYuanAndroid|SiYuanIOS|SiYuanHarmony/i.test(scope.navigator.userAgent));
    if (!native) {
        return {supported: true, nativeBoundary: false, credentialless};
    }
    let timer: number;
    try {
        // 原生壳只在可信主文档安装该只读方法；不能用 URL 参数或可见桥名称替代。
        const read = () => typeof environment.getAVMapNativeBoundary === "function" ?
            environment.getAVMapNativeBoundary() :
            environment.webkit?.messageHandlers?.getAVMapNativeBoundary?.postMessage(null);
        const report = await Promise.race([Promise.resolve().then(read), new Promise<undefined>((resolve) => {
            timer = scope.setTimeout(() => resolve(undefined), 3000);
        })]);
        return {supported: report?.version === 1 && report.enabled === true,
            nativeBoundary: report?.version === 1 && report.enabled === true, credentialless};
    } catch (_error) {
        return unsupported;
    } finally {
        scope.clearTimeout(timer);
    }
};
