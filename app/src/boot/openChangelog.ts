import {fetchSyncPost} from "../util/fetch";
import {MobileDialog as Dialog} from "../dialog/mobileDialog";
import {highlightRender} from "../protyle/render/highlightRender";
import {isMobile} from "../util/functions";
import {Constants} from "../constants";
import {sanitizeKernelHTML} from "../util/hostCapabilities";
import {withFetchTimeout} from "../util/fetchTimeout";
import {escapeHtml} from "../util/escape";
import type {SystemChangelogData} from "../types/api";

let manualRequest: ReturnType<typeof requestChangelog>;
let manualRequestVersion: string;
let manualRequestId = 0;

const requestChangelog = (force: boolean) => withFetchTimeout(signal =>
    fetchSyncPost("/api/system/getChangelog", {force}, undefined, false, signal), undefined, 15000);

const getChangelog = (force: boolean, version: string) => {
    if (!force) return requestChangelog(false);
    if (!manualRequest || manualRequestVersion !== version) {
        const pending = requestChangelog(true).finally(() => {
            if (manualRequest === pending) manualRequest = undefined;
        });
        manualRequest = pending;
        manualRequestVersion = version;
    }
    return manualRequest;
};

const sanitizeReleaseHTML = (html: string) => {
    const template = document.createElement("template");
    const allowedURI = /^https?:\/\//i;
    template.innerHTML = window.DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ["p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "a", "strong", "b", "em", "i",
            "s", "del", "u", "sub", "sup", "mark", "kbd", "pre", "code", "blockquote", "ul", "ol", "li",
            "table", "thead", "tbody", "tr", "th", "td", "img"],
        ALLOWED_ATTR: ["href", "title", "colspan", "rowspan", "start", "src", "alt", "width", "height"],
        ADD_URI_SAFE_ATTR: ["width", "height"],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
        ALLOWED_URI_REGEXP: allowedURI,
    });
    // DOMPurify 默认允许图片使用 data URI，在插入文档前限制为 HTTP(S) 资源。
    template.content.querySelectorAll("img[src]").forEach(image => {
        if (!allowedURI.test(image.getAttribute("src"))) image.removeAttribute("src");
    });
    return template.innerHTML;
};

export const openChangelog = async (force = false, button?: HTMLButtonElement) => {
    if (button?.disabled || button?.closest('[data-dialog-closing="true"]')) return;
    const requestId = force ? ++manualRequestId : 0;
    const kernelVersion = window.siyuan.config.system.kernelVersion;
    const icon = button?.querySelector("svg");
    const loading = button ? document.createElement("span") : undefined;
    const previousBusy = button?.getAttribute("aria-busy");
    if (button) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        loading.className = "b3-loading b3-loading--small";
        loading.setAttribute("aria-hidden", "true");
        loading.style.marginRight = "4px";
        icon?.replaceWith(loading);
    }
    try {
        let data: SystemChangelogData;
        try {
            const response = await getChangelog(force, kernelVersion);
            if (response.code === 0 && response.data?.show &&
                (!kernelVersion.includes("-") || response.data.version === kernelVersion)) data = response.data;
        } catch {
            // 手动查看统一提供同版本入口，启动期间不弹出网络错误。
        }
        if ((!data && !force) || (button && (!button.isConnected || button.closest('[data-dialog-closing="true"]'))) ||
            window.siyuan.config.system.kernelVersion !== kernelVersion ||
            (force && requestId !== manualRequestId)) return;

        const dialog = new Dialog({
            title: `✨ ${window.siyuan.languages.siyuanNote} v${escapeHtml(data?.version || kernelVersion)} ${window.siyuan.languages.changelog}`,
            width: isMobile() ? "92vw" : "768px",
            height: isMobile() ? "80vh" : "70vh",
            content: '<div style="overflow:auto;" class="b3-dialog__content b3-typography b3-typography--default"></div>',
        });
        dialog.element.setAttribute("data-key", Constants.DIALOG_CHANGELOG);
        const content = dialog.element.querySelector(".b3-dialog__content");
        if (data) {
            content.innerHTML = kernelVersion.includes("-") ? sanitizeReleaseHTML(data.html) : sanitizeKernelHTML(data.html);
            highlightRender(dialog.element);
        } else {
            const message = document.createElement("p");
            message.textContent = window.siyuan.languages.changelogUnavailable;
            const link = document.createElement("a");
            link.href = "https://github.com/siyuan-note/siyuan/releases/tag/" + encodeURIComponent("v" + kernelVersion);
            link.textContent = "GitHub Release v" + kernelVersion;
            content.append(message, link);
        }
        content.querySelectorAll("a[href]").forEach(link => {
            link.setAttribute("target", "_blank");
            link.setAttribute("rel", "noopener noreferrer");
        });
    } finally {
        if (button) {
            if (icon) loading.replaceWith(icon);
            button.disabled = false;
            if (previousBusy === null) button.removeAttribute("aria-busy");
            else button.setAttribute("aria-busy", previousBusy);
        }
    }
};
