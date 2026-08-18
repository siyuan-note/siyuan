import {escapeAttr, escapeHtml} from "../util/escape";

const DYNAMIC_ICON_PREFIX = "api/icon/getDynamicIcon";
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const BASE64_IMAGE_MIME_EXTENSIONS: Record<string, string> = {
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
};

export type TIconValueKind = "unicode" | "custom" | "dynamic" | "network" | "invalid";
export interface IBase64Image {
    bytes: Uint8Array,
    extension: string,
    mimeType: string,
}

export const normalizeNetworkIconURL = (value: string): string | undefined => {
    const icon = value.trim();
    let url: URL;
    try {
        url = new URL(icon);
    } catch {
        return;
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.host) {
        return;
    }
    return url.href;
};

export const getNetworkIconName = (value: string): string => {
    const normalizedURL = normalizeNetworkIconURL(value);
    if (!normalizedURL) {
        return "icon";
    }

    const pathSegment = new URL(normalizedURL).pathname.split("/").filter(Boolean).pop() || "";
    let name = pathSegment;
    try {
        name = decodeURIComponent(pathSegment);
    } catch {
        // 保留 URL 中未正确编码的路径名称。
    }
    const extension = name.match(/\.(?:gif|jpe?g|png|svg|webp)$/i)?.[0] || "";
    name = (name.replace(/\.[^.]*$/, "") || "icon") + extension;
    name = name.replace(/[\\/:*?"<>|]/g, "_");
    name = Array.from(name, character => character.charCodeAt(0) < 32 ? "_" : character).join("").trim();
    return name || "icon";
};

export const parseBase64Image = (value: string): IBase64Image | undefined => {
    const icon = value.trim();
    const commaIndex = icon.indexOf(",");
    if (commaIndex < 0) {
        return;
    }

    const header = icon.substring(0, commaIndex);
    const headerMatch = header.match(/^data:(image\/(?:gif|jpeg|png|svg\+xml|webp))(?:;[^,;]+)*;base64$/i);
    if (!headerMatch) {
        return;
    }
    const mimeType = headerMatch[1].toLowerCase();
    try {
        const binary = atob(icon.substring(commaIndex + 1).replace(/\s/g, ""));
        if (!binary) {
            return;
        }
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return {
            bytes,
            extension: BASE64_IMAGE_MIME_EXTENSIONS[mimeType],
            mimeType,
        };
    } catch {
        return;
    }
};

export const getIconValueKind = (value: string): TIconValueKind => {
    if (value.startsWith(DYNAMIC_ICON_PREFIX)) {
        return "dynamic";
    }
    if (normalizeNetworkIconURL(value)) {
        return "network";
    }
    if (URL_SCHEME_PATTERN.test(value) || value.startsWith("//")) {
        return "invalid";
    }
    if (value.includes(".")) {
        return "custom";
    }
    return "unicode";
};

export const normalizeRecentIconValue = (value: string): string | undefined => {
    const kind = getIconValueKind(value);
    if (kind === "invalid") {
        return;
    }
    if (kind === "network") {
        return normalizeNetworkIconURL(value);
    }
    if (kind !== "dynamic") {
        return value;
    }

    const [path, query = ""] = value.split("?", 2);
    const params = new URLSearchParams(query);
    params.delete("id");
    params.sort();
    const normalizedQuery = params.toString();
    return normalizedQuery ? `${path}?${normalizedQuery}` : path;
};

export const bindDynamicIconTarget = (value: string, targetID = ""): string => {
    if (getIconValueKind(value) !== "dynamic") {
        return value;
    }

    const [path, query = ""] = value.split("?", 2);
    const params = new URLSearchParams(query);
    if (params.get("type") === "8" && targetID) {
        params.set("id", targetID);
    } else {
        params.delete("id");
    }
    params.sort();
    const boundQuery = params.toString();
    return boundQuery ? `${path}?${boundQuery}` : path;
};

export const getIconSearchText = (value: string): string => {
    if (getIconValueKind(value) !== "dynamic") {
        return value;
    }
    const query = value.split("?", 2)[1] || "";
    const params = new URLSearchParams(query);
    return `${params.get("content") || ""} ${value}`;
};

export const updateRecentIconValues = (values: string[], value: string, max: number): string[] => {
    const recentValue = normalizeRecentIconValue(value);
    if (!recentValue) {
        return values;
    }

    const result = [recentValue];
    const seen = new Set(result);
    for (const item of values) {
        const normalizedItem = normalizeRecentIconValue(item);
        if (normalizedItem && !seen.has(normalizedItem)) {
            result.push(normalizedItem);
            seen.add(normalizedItem);
        }
        if (result.length === max) {
            break;
        }
    }
    return result;
};

export const genEmojiImageHTML = (value: string, className = "", lazy = false): string | undefined => {
    let src: string;
    let network = false;
    const kind = getIconValueKind(value);
    if (kind === "dynamic") {
        src = value.replaceAll("&amp;", "&");
    } else if (kind === "network") {
        src = normalizeNetworkIconURL(value.replaceAll("&amp;", "&"))!;
        network = true;
    } else if (kind === "custom") {
        src = `/emojis/${value}`;
    } else {
        return;
    }

    const safeClassName = escapeAttr(escapeHtml(className));
    const safeSrc = escapeAttr(escapeHtml(src));
    return `<img class="${safeClassName}" ${lazy ? "data-" : ""}src="${safeSrc}"${network ? ' referrerpolicy="no-referrer"' : ""}/>`;
};
