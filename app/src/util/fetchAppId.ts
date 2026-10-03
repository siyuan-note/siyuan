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

const getSameOriginURL = (input: RequestInfo | URL, baseURL: string, origin?: string) => {
    try {
        const requestURL = new URL(getRequestURL(input), baseURL);
        return requestURL.origin === (origin ?? new URL(baseURL).origin) ? requestURL : undefined;
    } catch {
        return undefined;
    }
};

export const isSameOriginAPIRequest = (input: RequestInfo | URL, baseURL: string, origin: string) =>
    getSameOriginURL(input, baseURL, origin)?.pathname.startsWith("/api/") ?? false;

const withAppIdHeaders = (input: RequestInfo | URL, init: RequestInit | undefined, appId: string): RequestInit => {
    const headers = new Headers(getRequestHeaders(input, init));
    headers.set(SIYUAN_APP_ID_HEADER, appId);
    return {...(init || {}), headers};
};

export const withAPIAppId = (input: RequestInfo | URL, init: RequestInit | undefined, appId: string,
                             baseURL: string, origin: string): RequestInit | undefined => {
    if (!isSameOriginAPIRequest(input, baseURL, origin)) {
        return init;
    }
    return withAppIdHeaders(input, init, appId);
};

export const isPluginStorageWriteRequest = (input: RequestInfo | URL, init: RequestInit | undefined,
                                             baseURL: string, origin?: string) => {
    if (getRequestMethod(input, init).toUpperCase() !== "POST") {
        return false;
    }
    const requestURL = getSameOriginURL(input, baseURL, origin);
    // 仅拦截与宿主共享窗口的插件使用的精确存储接口。
    return requestURL !== undefined && pluginStorageWritePaths.has(requestURL.pathname);
};

export const injectPluginStorageAppId = (inputFetch: typeof fetch, appId: string, baseURL: string,
                                         origin?: string): typeof fetch => {
    return ((input: RequestInfo | URL, init?: RequestInit) => {
        if (!isPluginStorageWriteRequest(input, init, baseURL, origin)) {
            return inputFetch(input, init);
        }
        return inputFetch(input, withAppIdHeaders(input, init, appId));
    }) as typeof fetch;
};

// 插件与宿主共享 window，提前包装原生 fetch 后可覆盖插件直接调用文件接口的场景。
export const installPluginStorageFetchAppId = (target: TFetchTarget, appId: string, baseURL: string, origin?: string) => {
    const currentFetch = target.fetch as typeof fetch & Record<symbol, boolean | undefined>;
    if (currentFetch[fetchAppIdMarker]) {
        return;
    }
    const wrappedFetch = injectPluginStorageAppId(currentFetch.bind(target), appId, baseURL, origin) as
        typeof fetch & Record<symbol, boolean | undefined>;
    Object.defineProperty(wrappedFetch, fetchAppIdMarker, {value: true});
    target.fetch = wrappedFetch;
};
