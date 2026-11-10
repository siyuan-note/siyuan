import type {
    OnCompletedListenerDetails,
    OnErrorOccurredListenerDetails,
    Session,
} from "electron";
import {writeLog as defaultWriteLog} from "../shared/runtime";
import type {LogFunction, KernelTarget} from "../shared/types";

const installedSessions = new WeakSet<Session>();

// 只记录接口名或资源类别，不记录文档、附件名称、查询参数及请求内容。
const getRequestPath = (pathname: string): string => {
    if (/^\/api\/(?:[A-Za-z]+\/)?[A-Za-z]+$/.test(pathname) || pathname === "/ws") {
        return pathname;
    }
    for (const prefix of ["/api/", "/assets/", "/stage/", "/appearance/", "/plugins/"]) {
        if (pathname.startsWith(prefix)) {
            return prefix + "[resource]";
        }
    }
    return "/[resource]";
};

const installKernelRequestLog = (session: Session,
    {getTarget, writeLog = defaultWriteLog, now = Date.now}: {
        getTarget: (webContentsId: number) => KernelTarget | undefined;
        writeLog?: LogFunction;
        now?: () => number;
    }): void => {
    if (installedSessions.has(session)) {
        return;
    }
    installedSessions.add(session);
    let intervalStart = now();
    let count = 0;
    const logFailure = (details: OnErrorOccurredListenerDetails | OnCompletedListenerDetails): void => {
        const webContentsId = details.webContentsId;
        if (webContentsId === undefined) {
            return;
        }
        const target = getTarget(webContentsId);
        if (target?.mode !== "local" || details.error === "net::ERR_ABORTED") {
            return;
        }
        let url: URL;
        try {
            url = new URL(details.url);
            // WebSocket 握手与 HTTP 请求按同一个内核地址归属。
            if (url.protocol === "ws:") url.protocol = "http:";
            if (url.protocol === "wss:") url.protocol = "https:";
            if (url.origin !== target.origin) return;
        } catch (error) {
            return;
        }
        // 限制集中失败时的日志量，避免资源加载失败淹没启动与退出记录。
        const time = now();
        if (time - intervalStart >= 30000) {
            intervalStart = time;
            count = 0;
        }
        count++;
        if (count > 30) {
            if (count === 31) {
                writeLog("local kernel request failures suppressed until the next 30-second interval");
            }
            return;
        }
        writeLog("local kernel request failed " + JSON.stringify({
            webContentsId: details.webContentsId,
            port: url.port,
            method: details.method,
            path: getRequestPath(url.pathname),
            resourceType: details.resourceType,
            error: details.error,
            statusCode: (details as OnCompletedListenerDetails).statusCode,
        }));
    };
    session.webRequest.onErrorOccurred(logFailure);
    session.webRequest.onCompleted((details: OnCompletedListenerDetails) => {
        if (details.statusCode >= 400) {
            logFailure(details);
        }
    });
};

export {installKernelRequestLog};
