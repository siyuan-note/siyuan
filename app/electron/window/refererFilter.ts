// 主窗口请求头过滤：按目标站点决定 Referer 去留，避免把本机来源泄露给第三方嵌入内容。
import type {OnBeforeSendHeadersListenerDetails} from "electron";

// 这些站点依赖 Referer 校验，命中后原样放行。
const PRESERVE_REFERER_MARKERS = [
    "bili", // B 站不移除 Referer https://github.com/siyuan-note/siyuan/issues/94
    "douyin", // 抖音 iframe 块内登录依赖 Referer 校验 https://github.com/siyuan-note/siyuan/issues/18070
];
// YouTube 要求带 Referer https://github.com/siyuan-note/siyuan/issues/16319
const REWRITE_REFERER_MARKER = "youtube";
const REWRITE_REFERER_VALUE = "https://b3log.org/siyuan/";

type HeadersCallback = (response: {requestHeaders: Record<string, string>}) => void;

const createRefererFilter = () => (details: OnBeforeSendHeadersListenerDetails,
    callback: HeadersCallback): void => {
    const url = details.url.toLowerCase();
    if (PRESERVE_REFERER_MARKERS.some(marker => -1 < url.indexOf(marker))) {
        callback({requestHeaders: details.requestHeaders});
        return;
    }
    if (-1 < url.indexOf(REWRITE_REFERER_MARKER)) {
        details.requestHeaders["Referer"] = REWRITE_REFERER_VALUE;
        callback({requestHeaders: details.requestHeaders});
        return;
    }
    for (const key in details.requestHeaders) {
        if ("referer" === key.toLowerCase()) {
            delete details.requestHeaders[key];
        }
    }
    callback({requestHeaders: details.requestHeaders});
};

export {createRefererFilter};
