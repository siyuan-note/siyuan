import {escapeAttr, escapeHtml} from "../util/escape";

const DYNAMIC_ICON_PREFIX = "api/icon/getDynamicIcon";
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

export type TIconValueKind = "unicode" | "custom" | "dynamic" | "network" | "invalid";

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
        src = value;
    } else if (kind === "network") {
        src = normalizeNetworkIconURL(value)!;
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
