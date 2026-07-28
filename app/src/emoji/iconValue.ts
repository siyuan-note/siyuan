import {escapeAttr, escapeHtml} from "../util/escape";

const DYNAMIC_ICON_PREFIX = "api/icon/getDynamicIcon";
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

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

export const genEmojiImageHTML = (value: string, className = "", lazy = false): string | undefined => {
    let src: string;
    let network = false;
    if (value.startsWith(DYNAMIC_ICON_PREFIX)) {
        src = value;
    } else {
        const networkURL = normalizeNetworkIconURL(value);
        if (networkURL) {
            src = networkURL;
            network = true;
        } else if (URL_SCHEME_PATTERN.test(value) || value.startsWith("//")) {
            return;
        } else if (value.includes(".")) {
            src = `/emojis/${value}`;
        } else {
            return;
        }
    }

    const safeClassName = escapeAttr(escapeHtml(className));
    const safeSrc = escapeAttr(escapeHtml(src));
    return `<img class="${safeClassName}" ${lazy ? "data-" : ""}src="${safeSrc}"${network ? ' referrerpolicy="no-referrer"' : ""}/>`;
};
