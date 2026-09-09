// 使用会话 Cookie 探测鉴权状态，在重定向事件中判断登录页并终止请求。
const probeRemoteKernelAuthentication = (net, session, url, timeout = 5000) => new Promise((resolve, reject) => {
    const origin = new URL(url).origin;
    const request = net.request({
        url,
        method: "GET",
        session,
        credentials: "include",
        bypassCustomProtocolHandlers: true,
        cache: "no-store",
        redirect: "manual",
    });
    let settled = false;
    const finish = (error, authenticated) => {
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
    request.on("error", (error) => finish(error));
    request.on("redirect", (status, method, location) => {
        try {
            const redirectURL = new URL(location, url);
            if (redirectURL.origin === origin && !redirectURL.username && !redirectURL.password &&
                redirectURL.pathname === "/check-auth") {
                finish(null, false);
                return;
            }
        } catch (error) {
            finish(error);
            return;
        }
        finish(new Error("authentication probe returned an unexpected redirect [HTTP " + status +
            ", method=" + method + "]"));
    });
    request.on("response", (response) => {
        response.on("error", (error) => finish(error));
        const status = response.statusCode;
        if (status === 401) {
            finish(null, false);
        } else if (status >= 200 && status < 300) {
            finish(null, true);
        } else {
            const error = new Error("authentication probe returned HTTP " + status);
            error.statusCode = status;
            finish(error);
        }
    });
    try {
        request.end();
    } catch (error) {
        finish(error);
    }
});

module.exports = {probeRemoteKernelAuthentication};
