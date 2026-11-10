import {withFetchTimeout} from "../util/fetchTimeout";

let pending = true;
let diagnostic = "";
export const getStartupReadDiagnostic = () => diagnostic;
export const finishStartupReads = () => {pending = false;};

const reads = new Set([
    "/api/system/getConf", "/api/petal/loadPetals", "/api/storage/getLocalStorage",
    "/api/setting/getCloudUser", "/api/system/getEmojiConf",
]);

export const fetchStartupRead = async (input: RequestInfo | URL, init?: RequestInit,
                                       request: typeof fetch = fetch): Promise<Response> => {
    const url = typeof input === "string" ? input : "";
    const method = init?.method?.toUpperCase() || "GET";
    if (!pending || !((method === "POST" && reads.has(url)) ||
        (method === "GET" && /^\/appearance\/langs\/[a-zA-Z-]+\.json(?:\?|$)/.test(url)))) {
        return request(input, init);
    }
    for (let attempt = 1; ; attempt++) {
        diagnostic = `url=${url}\nattempts=${attempt}`;
        try {
            return await withFetchTimeout(signal => request(input, {...init, signal}), init?.signal, 3000);
        } catch (error) {
            if (init?.signal?.aborted || !(error instanceof TypeError ||
                error instanceof DOMException && error.name === "TimeoutError")) throw error;
            if (attempt === 3 || !pending) {
                throw new Error(`url=${url}\nattempts=${attempt}\n${String(error)}`, {cause: error});
            }
            await new Promise(resolve => setTimeout(resolve, attempt * 300));
        }
    }
};
