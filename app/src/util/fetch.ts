import {Constants} from "../constants";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {processMessage} from "./processMessage";
import {kernelError} from "../dialog/processSystem";

export const fetchPost = (
    url: string,
    data?: any,
    cb?: (response: IWebSocketData) => void,
    headers?: IObject,
    failCallback?: (response: IWebSocketData) => void) => {
    const init: RequestInit = {
        method: "POST",
    };
    if (data) {
        if (["/api/search/searchRefBlock", "/api/graph/getGraph", "/api/graph/getLocalGraph",
            "/api/block/getRecentUpdatedBlocks", "/api/search/fullTextSearchBlock"].includes(url)) {
            window.siyuan.reqIds[url] = new Date().getTime();
            if (data.type === "local" && url === "/api/graph/getLocalGraph") {
                // 当打开文档A的关系图、关系图、文档A后刷新，由于防止请求重复处理，文档A关系图无法渲染。
            } else {
                data.reqId = window.siyuan.reqIds[url];
            }
        }
        // 并发导出后端接受顺序不一致
        if (url === "/api/transactions") {
            data.reqId = new Date().getTime();
        }
        if (data instanceof FormData) {
            init.body = data;
        } else {
            init.body = JSON.stringify(data);
        }
    }
    if (headers) {
        init.headers = headers;
    }
    let isGetFile202 = false;
    fetch(url, init).then((response) => {
        switch (response.status) {
            case 403:
            case 404:
                return {
                    data: null,
                    msg: response.statusText,
                    code: -response.status,
                };
            case 401:
                // 返回鉴权失败的话直接刷新页面，避免用户在当前页面操作 https://github.com/siyuan-note/siyuan/issues/15163
                setTimeout(() => {
                    window.location.reload();
                }, 3000);
                return {
                    data: null,
                    msg: response.statusText,
                    code: -response.status,
                };
            default:
                // /api/file/getFile 接口返回202时表示文件没有正常读取
                if (response.status === 202 && url === "/api/file/getFile") {
                    isGetFile202 = true;
                }
                if (response.headers.get("content-type")?.indexOf("application/json") > -1) {
                    return response.json();
                } else {
                    return response.text();
                }
        }
    }).then((response: IWebSocketData) => {
        if (failCallback && url === "/api/file/getFile" && isGetFile202) {
            failCallback(response);
            return;
        }
        if (typeof response === "string") {
            if (cb) {
                cb(response);
            }
            return;
        }
        if (["/api/search/searchRefBlock", "/api/graph/getGraph", "/api/graph/getLocalGraph",
            "/api/block/getRecentUpdatedBlocks", "/api/search/fullTextSearchBlock"].includes(url)) {
            if (response.data.reqId && window.siyuan.reqIds[url] && window.siyuan.reqIds[url] > response.data.reqId) {
                return;
            }
        }
        if (typeof response === "object" && typeof response.msg === "string" && typeof response.code === "number") {
            if (processMessage(response) && cb) {
                cb(response);
            }
        } else if (cb) {
            cb(response);
        }
    }).catch((e) => {
        if (failCallback && url === "/api/file/getFile") {
            failCallback({
                data: null,
                msg: e.message,
                code: 400,
            });
            return;
        }
        console.warn("fetch post failed [" + e + "], url [" + url + "]");
        if (url === "/api/transactions" && (e.message === "Failed to fetch" || e.message === "Unexpected end of JSON input")) {
            kernelError();
            return;
        }
        /// #if !BROWSER
        if (url === "/api/system/exit" || url === "/api/system/setWorkspaceDir" || (
            ["/api/system/setUILayout"].includes(url) && data.errorExit // 内核中断，点关闭处理
        )) {
            ipcRenderer.send(Constants.SIYUAN_QUIT, location.port);
        }
        /// #endif
    });
};

export const fetchSyncPost = async (url: string, data?: any) => {
    const init: RequestInit = {
        method: "POST",
    };
    if (data) {
        if (data instanceof FormData) {
            init.body = data;
        } else {
            init.body = JSON.stringify(data);
        }
    }
    const res = await fetch(url, init);
    const res2 = await res.json() as IWebSocketData;
    processMessage(res2);
    return res2;
};

export const fetchGet = (url: string, cb: (response: IWebSocketData | IObject | string) => void) => {
    fetch(url).then((response) => {
        if (response.headers.get("content-type")?.indexOf("application/json") > -1) {
            return response.json();
        } else {
            return response.text();
        }
    }).then((response) => {
        cb(response);
    });
};
