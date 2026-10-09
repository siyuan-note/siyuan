export type ParsedSiYuanUri = Pick<URL, "protocol" | "hostname" | "pathname" | "searchParams" | "href">;

export const normalizeSiYuanUri = (uri: URL): ParsedSiYuanUri => {
    if (uri.hostname || !uri.pathname.startsWith("//")) {
        return uri;
    }
    // 从原始链接恢复自定义协议的主机与路径，兼容将 authority 合并到 pathname 的 WebView。
    const match = /^\/\/([^/?#\\]+)(\/[^?#]*)?(?:[?#]|$)/.exec(uri.href.substring(uri.protocol.length));
    if (!match) {
        return uri;
    }
    const authority = /^(?:[^@]*@)?([^:]+)(?::(\d+))?$/.exec(match[1]);
    if (!authority || (authority[2] && Number(authority[2]) > 65535)) {
        return uri;
    }
    return {
        protocol: uri.protocol,
        hostname: authority[1],
        pathname: match[2] || "",
        searchParams: uri.searchParams,
        href: uri.href,
    };
};
