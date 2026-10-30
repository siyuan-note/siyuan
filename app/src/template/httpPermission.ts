import {fetchSyncPost} from "../util/fetch";
import {clearTemplateHTTPConfirmations} from "./httpConfirmHandoff";

export type TemplateHTTPPermissionSource = {kind: "file", path: string} |
    {kind: "av", avID: string, keyID: string, slot: "template" | "renderTemplate"};

export const templateHTTPPermission = async (action: "get" | "revoke" | "revokeAll",
                                            source?: TemplateHTTPPermissionSource) => {
    const response = await fetchSyncPost("/api/template/httpPermission", {action, ...source});
    if (response.code !== 0) {
        return undefined;
    }
    if (action !== "get") {
        // 撤销后不能再通过旧预览的一次性凭据恢复许可。
        clearTemplateHTTPConfirmations();
    }
    return response.data.allowed;
};

export const templateHTTPPermissionLabel = (allowed?: boolean) => allowed === undefined ?
    window.siyuan.languages.templateHTTPPermissionUnknown : window.siyuan.languages[
        allowed ? "templateHTTPAllowed" : "templateHTTPNotAllowed"];

export const templateHTTPPermissionHTML = (slot: "template" | "renderTemplate") =>
    `<button class="b3-menu__item" data-http-permission="${slot}">
<span class="b3-menu__label">${window.siyuan.languages.templateHTTPRevoke}</span>
<span class="b3-menu__accelerator">${templateHTTPPermissionLabel()}</span></button>`;

export const bindTemplateHTTPPermission = (element: HTMLElement,
                                          source: Extract<TemplateHTTPPermissionSource, {kind: "av"}>) => {
    const button = element.querySelector<HTMLButtonElement>(`[data-http-permission="${source.slot}"]`);
    if (!button) return;
    const textarea = element.querySelector<HTMLTextAreaElement>(`[data-type="${source.slot === "template" ?
        "updateTemplate" : "updateRenderTemplate"}"]`);
    const label = button.querySelector(".b3-menu__accelerator");
    let version = 0;
    const refresh = async (action: "get" | "revoke") => {
        const current = ++version;
        button.disabled = true;
        try {
            const allowed = await templateHTTPPermission(action, source);
            if (!button.isConnected || current !== version) return;
            label.textContent = templateHTTPPermissionLabel(allowed);
            button.disabled = allowed === false;
        } catch {
            if (!button.isConnected || current !== version) return;
            label.textContent = templateHTTPPermissionLabel();
            button.disabled = false;
        }
    };
    button.addEventListener("click", event => {
        event.stopPropagation();
        void refresh("revoke");
    });
    textarea?.addEventListener("input", () => {
        // 本地未保存源码不能沿用旧版本的许可状态。
        version++;
        label.textContent = templateHTTPPermissionLabel();
        button.disabled = false;
    });
    void refresh("get");
};
