const THUMBNAIL_EXTENSIONS = [".png", ".jpg", ".jpeg", ".heic", ".heif"];
const HEIF_EXTENSIONS = [".heic", ".heif"];
const FALLBACK_ORIGIN = "http://siyuan.invalid";

interface IAssetURLParts {
    path: string;
    query?: string;
    fragment: string;
}

const getDecodedPath = (url: string) => {
    const path = url.trim().split(/[?#]/, 1)[0];
    try {
        return decodeURIComponent(path).toLowerCase();
    } catch {
        return path.toLowerCase();
    }
};

const resolveHTTPURL = (url: string, origin?: string) => {
    const value = url.trim();
    if (!value || /^file:/i.test(value) || /^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\")) {
        return;
    }
    const currentOrigin = origin || (typeof location === "undefined" ? FALLBACK_ORIGIN : location.origin);
    try {
        const baseURL = new URL(currentOrigin);
        if (baseURL.protocol !== "http:" && baseURL.protocol !== "https:") {
            return;
        }
        const resolvedURL = new URL(value, `${baseURL.origin}/`);
        if ((resolvedURL.protocol !== "http:" && resolvedURL.protocol !== "https:") ||
            resolvedURL.origin !== baseURL.origin) {
            return;
        }
        return resolvedURL;
    } catch {
        return;
    }
};

const parseAssetURL = (url: string): IAssetURLParts | undefined => {
    const fragmentIndex = url.indexOf("#");
    const fragment = fragmentIndex === -1 ? "" : url.substring(fragmentIndex);
    const urlWithoutFragment = fragmentIndex === -1 ? url : url.substring(0, fragmentIndex);
    const queryIndex = urlWithoutFragment.indexOf("?");
    const path = queryIndex === -1 ? urlWithoutFragment : urlWithoutFragment.substring(0, queryIndex);
    if (!path.startsWith("assets/") || !THUMBNAIL_EXTENSIONS.some(extension => path.toLowerCase().endsWith(extension))) {
        return;
    }
    return {
        path,
        query: queryIndex === -1 ? undefined : urlWithoutFragment.substring(queryIndex + 1),
        fragment,
    };
};

export const isHEIFPath = (url: string) => {
    const path = getDecodedPath(url);
    return HEIF_EXTENSIONS.some(extension => path.endsWith(extension));
};

export const isInternalHEIFPath = (url: string, origin?: string) => {
    if (!isHEIFPath(url)) {
        return false;
    }
    const resolvedURL = resolveHTTPURL(url, origin);
    if (!resolvedURL) {
        return false;
    }
    try {
        return decodeURIComponent(resolvedURL.pathname).startsWith("/assets/");
    } catch {
        return false;
    }
};

export const isBrowserRenderableImagePath = (url: string, origin?: string) => {
    if (!isHEIFPath(url)) {
        return true;
    }
    const resolvedURL = resolveHTTPURL(url, origin);
    return isInternalHEIFPath(url, origin) &&
        !resolvedURL?.searchParams.getAll("download").some(value => value.toLowerCase() === "true");
};

export const getDownloadURL = (url: string) => {
    const fragmentIndex = url.indexOf("#");
    const fragment = fragmentIndex === -1 ? "" : url.substring(fragmentIndex);
    const urlWithoutFragment = fragmentIndex === -1 ? url : url.substring(0, fragmentIndex);
    const queryIndex = urlWithoutFragment.indexOf("?");
    const path = queryIndex === -1 ? urlWithoutFragment : urlWithoutFragment.substring(0, queryIndex);
    const parameters = new URLSearchParams(queryIndex === -1 ? "" : urlWithoutFragment.substring(queryIndex + 1));
    parameters.set("download", "true");
    return `${path}?${parameters.toString()}${fragment}`;
};

export const getCompressURL = (url: string) => {
    const parts = parseAssetURL(url);
    if (!parts) {
        return url;
    }
    const parameters = parts.query ? parts.query.split("&") : [];
    let hasStyle = false;
    const updatedParameters = parameters.reduce<string[]>((result, parameter) => {
        if (parameter.split("=", 1)[0] !== "style") {
            result.push(parameter);
        } else if (!hasStyle) {
            result.push("style=thumb");
            hasStyle = true;
        }
        return result;
    }, []);
    if (!hasStyle) {
        updatedParameters.push("style=thumb");
    }
    return `${parts.path}?${updatedParameters.join("&")}${parts.fragment}`;
};

export const removeCompressURL = (url: string) => {
    const parts = parseAssetURL(url);
    if (!parts?.query) {
        return url;
    }
    const parameters = parts.query.split("&");
    const remainingParameters = parameters.filter(parameter => parameter !== "style=thumb");
    if (remainingParameters.length === parameters.length) {
        return url;
    }
    const query = remainingParameters.length > 0 ? `?${remainingParameters.join("&")}` : "";
    return `${parts.path}${query}${parts.fragment}`;
};
