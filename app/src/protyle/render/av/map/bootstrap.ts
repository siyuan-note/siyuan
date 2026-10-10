import {AVMapProvider} from "./protocol";
import {prepareAVMapAssets} from "./providersLoader";

// 第二阶段策略与响应头相交；不保留本地来源、nonce 或可重用的脚本 hash。
// 删除 meta 不能撤回已经施加的策略。外层 wrapper 另行约束跨文档导航。
export const getAVMapLockedPolicy = (provider: AVMapProvider): string => {
    let scripts = "'none'";
    let connect = "'none'";
    let images = "data: blob:";
    let workers = "'none'";
    switch (provider) {
        case "openfreemap":
            connect = "https://tiles.openfreemap.org";
            images += " https://tiles.openfreemap.org";
            workers = "blob:";
            break;
        case "amap":
            scripts = "https://webapi.amap.com https://restapi.amap.com https://jsapi-service.amap.com";
            workers = "blob:";
            connect = "https://webapi.amap.com https://restapi.amap.com https://vdata.amap.com https://jsapi.amap.com";
            images += " https://webapi.amap.com https://a.amap.com https://*.is.autonavi.com";
            break;
        case "tencent":
            scripts = "https://map.qq.com";
            connect = "https://map.qq.com https://apis.map.qq.com https://*.map.qq.com";
            images += " https://map.qq.com https://*.map.qq.com";
            break;
        case "baidu":
            scripts = "https://api.map.baidu.com";
            connect = "https://api.map.baidu.com https://*.map.bdimg.com https://*.bdimg.com";
            images += " https://api.map.baidu.com https://*.map.bdimg.com https://*.bdimg.com https://*.map.baidu.com";
            break;
    }
    return `default-src 'none'; script-src ${scripts}; connect-src ${connect}; img-src ${images}; ` +
        `style-src 'unsafe-inline'; font-src 'none'; worker-src ${workers}; child-src ${provider === "openfreemap" ? workers : "'none'"}; ` +
        "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
};

export const prepareAVMapBootstrap = async (scope: Window, provider: AVMapProvider, signal: AbortSignal): Promise<() => void> => {
    const assets = await prepareAVMapAssets(scope, provider, signal);
    try {
        if (signal.aborted) {
            throw new Error("hostUnavailable");
        }
        const policy = scope.document.createElement("meta");
        policy.httpEquiv = "Content-Security-Policy";
        policy.content = getAVMapLockedPolicy(provider);
        scope.document.head.appendChild(policy);
        // 此时尚未构造任何 Map、Worker 或 Worker blob。后续创建继承收紧后的策略。
        assets.lock();
        return assets.destroy;
    } catch (_error) {
        assets.destroy();
        throw new Error("hostUnavailable");
    }
};
