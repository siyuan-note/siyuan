import {getHostCapabilities} from "../util/hostCapabilities";

const REMOTE_ACTIVE_CONTENT_SELECTOR = "script, object, embed, frame, frameset, portal, base, meta[http-equiv]";
const REMOTE_URL_ATTRIBUTES = new Set(["action", "formaction", "href", "poster", "src", "xlink:href"]);

const isDangerousRemoteURL = (element: Element, attributeName: string, value: string) => {
    if (!REMOTE_URL_ATTRIBUTES.has(attributeName)) {
        return false;
    }
    const normalized = Array.from(value).filter((character) => {
        const characterCode = character.charCodeAt(0);
        return characterCode > 0x20 && (characterCode < 0x7f || characterCode > 0x9f);
    }).join("").toLowerCase();
    if (normalized.startsWith("javascript:") || normalized.startsWith("vbscript:") ||
        normalized.startsWith("file:") || normalized.startsWith("blob:")) {
        return true;
    }
    if (!normalized.startsWith("data:")) {
        return false;
    }
    return element.tagName !== "IMG" ||
        !/^data:image\/(?:avif|bmp|gif|jpeg|png|webp);base64,/.test(normalized);
};

export const isHTMLFilePath = (value: string) => {
    const path = value.split(/[?#]/, 1)[0].toLowerCase();
    return path.endsWith(".html") || path.endsWith(".htm");
};

export const isLocalHTMLAssetPath = (value: string) => {
    const path = value.split(/[?#]/, 1)[0];
    const normalizedPath = path.startsWith("./") ? path.substring(2) : path;
    return (normalizedPath.startsWith("assets/") || normalizedPath.startsWith("/assets/")) &&
        isHTMLFilePath(normalizedPath);
};

export const getHTMLAssetIFrameSrc = (assetPath: string) => {
    if (!isLocalHTMLAssetPath(assetPath)) {
        return assetPath;
    }
    const hashIndex = assetPath.indexOf("#");
    const hash = hashIndex > -1 ? assetPath.substring(hashIndex) : "";
    const pathAndQuery = hashIndex > -1 ? assetPath.substring(0, hashIndex) : assetPath;
    const queryIndex = pathAndQuery.indexOf("?");
    const path = queryIndex > -1 ? pathAndQuery.substring(0, queryIndex) : pathAndQuery;
    const params = new URLSearchParams(queryIndex > -1 ? pathAndQuery.substring(queryIndex + 1) : "");
    params.set("iframe", "true");
    return `${path}?${params.toString()}${hash}`;
};

export const normalizeHTMLAssetIFrameSources = (
    root: ParentNode,
    remoteKernel = typeof window !== "undefined" && getHostCapabilities().remoteKernel,
) => {
    let changed = false;
    if (!remoteKernel) {
        root.querySelectorAll<HTMLIFrameElement>('[data-type="NodeIFrame"] iframe').forEach(item => {
            const src = item.getAttribute("src");
            if (!src) {
                return;
            }
            const normalizedSrc = getHTMLAssetIFrameSrc(src);
            if (normalizedSrc !== src) {
                item.setAttribute("src", normalizedSrc);
                changed = true;
            }
        });
    }
    if (remoteKernel) {
        root.querySelectorAll<Element>(REMOTE_ACTIVE_CONTENT_SELECTOR).forEach(item => {
            item.remove();
            changed = true;
        });
        root.querySelectorAll<Element>("*").forEach(item => {
            // 远程桌面由宿主 CSP 和导航拦截禁用 iframe，保留属性可避免编辑时写回禁用状态。
            if (item.tagName === "IFRAME") {
                return;
            }
            Array.from(item.attributes).forEach(attribute => {
                const name = attribute.name.toLowerCase();
                if (name.startsWith("on") || name === "srcdoc" ||
                    isDangerousRemoteURL(item, name, attribute.value)) {
                    item.removeAttribute(attribute.name);
                    changed = true;
                }
            });
        });
        root.querySelectorAll<HTMLTemplateElement>("template").forEach(item => {
            if (normalizeHTMLAssetIFrameSources(item.content, true)) {
                changed = true;
            }
        });
    }
    return changed;
};

export const normalizeHTMLAssetIFrameBlockDOM = (html: string) => {
    const remoteKernel = getHostCapabilities().remoteKernel;
    if (!remoteKernel && (!html.includes("NodeIFrame") || !html.includes("<iframe"))) {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    if (!normalizeHTMLAssetIFrameSources(template.content, remoteKernel)) {
        return html;
    }
    return template.innerHTML;
};
