// KaTeX 在 trust 开启时会原样输出 \href、\url、\includegraphics 的 URL，因此按协议白名单放行，
// 避免 javascript: 等可执行 URL 被写入 a[href] / img[src]。相对地址由 KaTeX 归一化为 _relative。
const SAFE_URL_PROTOCOLS = ["http", "https", "mailto", "_relative"];

export const isSafeMathURLProtocol = (protocol?: string) => SAFE_URL_PROTOCOLS.includes(protocol);

export const getMathRenderSecurity = (remoteKernel: boolean, safeRender: boolean) => {
    // 本地内核的公式支持 \href、\includegraphics 等 HTML 相关命令，但按协议白名单放行，不做无条件信任
    const trustURLCommand = !remoteKernel && !safeRender;
    return {
        trust: trustURLCommand ?
            (context: {command: string; url?: string; protocol?: string}) => {
                // \htmlClass、\htmlId、\htmlStyle、\htmlData 只携带属性，不构成跳转或请求目标，沿用 KaTeX 的默认信任
                if (context.url === undefined) {
                    return true;
                }
                return isSafeMathURLProtocol(context.protocol);
            } :
            false,
        sanitize: remoteKernel || safeRender,
    };
};
