import * as electron from "electron";
import type {ClientRequest, IncomingMessage, Session} from "electron";

type ProbeError = Error & {statusCode?: number};

// 使用会话 Cookie 探测鉴权状态，在重定向事件中判断登录页并终止请求；timeout 省略时使用默认值。
const probeRemoteKernelAuthentication = ({session, url, timeout = 5000}: {
    session: Session;
    url: string;
    timeout?: number;
}): Promise<boolean> => new Promise<boolean>((resolve, reject) => {
    const origin = new URL(url).origin;
    const request: ClientRequest = electron.net.request({
        url,
        method: "GET",
        session,
        credentials: "include",
        bypassCustomProtocolHandlers: true,
        cache: "no-store",
        redirect: "manual",
    });
    let settled = false;
    const finish = (error: ProbeError | null | undefined, authenticated = false): void => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(timer);
        if (error) {
            reject(error);
        } else {
            resolve(authenticated);
        }
        request.abort();
    };
    const timer = setTimeout(() => finish(new Error("authentication probe timed out")), timeout);
    request.on("error", (error: Error) => finish(error));
    request.on("redirect", (status: number, method: string, location: string) => {
        try {
            const redirectURL = new URL(location, url);
            if (redirectURL.origin === origin && !redirectURL.username && !redirectURL.password &&
                redirectURL.pathname === "/check-auth") {
                finish(null, false);
                return;
            }
        } catch (error) {
            finish(error as ProbeError);
            return;
        }
        finish(new Error("authentication probe returned an unexpected redirect [HTTP " + status +
            ", method=" + method + "]"));
    });
    request.on("response", (response: IncomingMessage) => {
        response.on("error", (error: Error) => finish(error));
        const status = response.statusCode;
        if (status === 401) {
            finish(null, false);
        } else if (status >= 200 && status < 300) {
            finish(null, true);
        } else {
            const error: ProbeError = Object.assign(new Error("authentication probe returned HTTP " + status), {statusCode: status});
            finish(error);
        }
    });
    try {
        request.end();
    } catch (error) {
        finish(error as ProbeError);
    }
});

export {probeRemoteKernelAuthentication};
