import type {OnHeadersReceivedListenerDetails} from "electron";
import {APP_PAGE, CHECK_AUTH_PAGE, SETTINGS_PAGE, WINDOW_PAGE} from "../shared/pagePaths";
import type {KernelTarget} from "../shared/types";

// 嵌入页面需要跨域资源与远端文档自身的 CSP，其余响应头保持原样。
// 远端内核只在自身文档路径上保留 CSP，静态资源不保留，否则内联脚本会被拦截。
const createResponseHeaderFilter = (kernelTarget: KernelTarget) =>
    (details: OnHeadersReceivedListenerDetails,
        cb: (response: {responseHeaders: Record<string, string[]>}) => void): void => {
        let preserveRemoteDocumentCSP = false;
        if (kernelTarget.mode === "remote") {
            try {
                const responseURL = new URL(details.url);
                preserveRemoteDocumentCSP = responseURL.origin === kernelTarget.origin &&
                    [CHECK_AUTH_PAGE, APP_PAGE, WINDOW_PAGE, SETTINGS_PAGE].includes(responseURL.pathname);
            } catch (error) {
                preserveRemoteDocumentCSP = false;
            }
        }
        for (const key in details.responseHeaders) {
            if ("x-frame-options" === key.toLowerCase()) {
                delete details.responseHeaders[key];
            } else if ("content-security-policy" === key.toLowerCase()) {
                if (!preserveRemoteDocumentCSP) {
                    delete details.responseHeaders[key];
                }
            }
        }
        cb({responseHeaders: details.responseHeaders || {}});
    };

export {createResponseHeaderFilter};
