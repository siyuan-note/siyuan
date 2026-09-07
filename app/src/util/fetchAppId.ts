const pluginStorageWritePaths = new Set([
    "/api/file/putFile",
    "/api/file/removeFile",
]);

const fetchAppIdMarker = Symbol.for("siyuan.fetchAppId");

export const SIYUAN_APP_ID_HEADER = "X-SiYuan-App-ID";

type TFetchTarget = {
    fetch: typeof fetch;
};

const getRequestURL = (input: RequestInfo | URL) => {
    if (typeof input === "string") {
        return input;
    }
    return "url" in input ? input.url : input.href;
};

const getRequestMethod = (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== undefined) {
        return init.method;
    }
    if (typeof input !== "string" && "method" in input) {
        return input.method;
    }
    return "GET";
};

const getRequestHeaders = (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.headers !== undefined) {
        return init.headers;
    }
    if (typeof input !== "string" && "headers" in input) {
        return input.headers;
    }
    return undefined;
};

export const isPluginStorageWriteRequest = (input: RequestInfo | URL, init: RequestInit | undefined,
                                             baseURL: string) => {
    if (getRequestMethod(input, init).toUpperCase() !== "POST") {
        return false;
    }
    try {
        const frontendURL = new URL(baseURL);
        const requestURL = new URL(getRequestURL(input), frontendURL);
        // 只处理当前思源前端对应的精确接口，避免向插件访问的外部服务发送应用标识。
        return requestURL.origin === frontendURL.origin && pluginStorageWritePaths.has(requestURL.pathname);
    } catch {
        return false;
    }
};

export const injectPluginStorageAppId = (inputFetch: typeof fetch, appId: string, baseURL: string): typeof fetch => {
    return ((input: RequestInfo | URL, init?: RequestInit) => {
        if (!isPluginStorageWriteRequest(input, init, baseURL)) {
            return inputFetch(input, init);
        }
        const headers = new Headers(getRequestHeaders(input, init));
        headers.set(SIYUAN_APP_ID_HEADER, appId);
        return inputFetch(input, {...(init || {}), headers});
    }) as typeof fetch;
};

// 插件与宿主共享 window，提前包装原生 fetch 后可覆盖插件直接调用文件接口的场景。
export const installPluginStorageFetchAppId = (target: TFetchTarget, appId: string, baseURL: string) => {
    const currentFetch = target.fetch as typeof fetch & Record<symbol, boolean | undefined>;
    if (currentFetch[fetchAppIdMarker]) {
        return;
    }
    const wrappedFetch = injectPluginStorageAppId(currentFetch.bind(target), appId, baseURL) as
        typeof fetch & Record<symbol, boolean | undefined>;
    Object.defineProperty(wrappedFetch, fetchAppIdMarker, {value: true});
    target.fetch = wrappedFetch;
};
