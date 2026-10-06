import {fetchPost} from "../../../util/fetch";
import type {ChatGPTAccount} from "../../../types/api";
import {escapeHtmlTextAndAttr} from "../../../util/escape";
import {showMessage} from "../../../dialog/message";
import {genConfigItemMainHtml} from "../../render/fragments";
import {openByMobile} from "../../../editor/openLink";
import {isInMobileApp, saveExportFile} from "../../../protyle/util/compatibility";
import {getHostCapabilities} from "../../../util/hostCapabilities";
/// #if !BROWSER
import {shell} from "electron";
/// #endif

const openExternal = (url: string) => {
    /// #if !BROWSER
    void shell.openExternal(url);
    /// #else
    openByMobile(url);
    /// #endif
};

export const genChatGPTAccountHTML = () => {
    const L = window.siyuan.languages;
    return `<div class="b3-label config-item" data-type="chatGPTAccount">
        ${genConfigItemMainHtml(L.chatGPTAccount, L.chatGPTPlanUsageTip)}
        <div class="fn__none" data-chatgpt="accountRow">
            <div class="fn__hr"></div>
            <div data-chatgpt="accountInfo"></div>
            <select class="b3-select fn__block fn__none" data-chatgpt="account" aria-label="${L.chatGPTAccount}"></select>
        </div>
        <div class="fn__hr"></div>
        <div class="fn__flex fn__flex-wrap">
            <button class="b3-button" data-chatgpt="login">${L.chatGPTConnect}</button>
            <span class="fn__space"></span>
            <button class="b3-button b3-button--outline fn__none" data-chatgpt="add">${L.chatGPTAddAccount}</button>
            <span class="fn__space"></span>
            <button class="b3-button b3-button--outline fn__none" data-chatgpt="logout">${L.logout}</button>
            <span class="fn__space"></span>
            <button class="b3-button b3-button--outline fn__none" data-chatgpt="usage">${L.chatGPTUsage}</button>
            <span class="fn__space"></span>
            <button class="b3-button b3-button--cancel fn__none" data-chatgpt="cancel">${L.cancel}</button>
        </div>
        <div class="fn__none" data-chatgpt="statusRow">
            <div class="fn__hr"></div>
            <div class="ft__on-surface" data-chatgpt="status"></div>
        </div>
        <div class="fn__hr"></div>
        <div class="ft__on-surface">${L.chatGPTRemoteTip}</div>
        <div class="fn__hr"></div>
        <label class="fn__flex">${L.password}<span class="fn__space"></span><input class="b3-text-field fn__flex-1" data-chatgpt="password" type="password" minlength="12" autocomplete="new-password"></label>
        <div class="fn__hr"></div>
        <div class="ft__on-surface">${L.chatGPTTransferTip}</div>
        <div class="fn__hr"></div>
        <div class="fn__flex fn__flex-wrap">
            <button class="b3-button b3-button--outline" data-chatgpt="export">${L.export}</button>
            <span class="fn__space"></span>
            <button class="b3-button b3-button--outline" data-chatgpt="import">${L.import}</button>
            <input class="fn__none" data-chatgpt="file" type="file" accept=".json">
        </div>
    </div>`;
};

export const mountChatGPTAccount = (view: HTMLElement, draft: Config.IProvider, onChange: (ready: boolean) => void) => {
    const root = view.querySelector<HTMLElement>("[data-type='chatGPTAccount']");
    const localKernel = !getHostCapabilities().remoteKernel && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
    const picker = root.querySelector<HTMLSelectElement>("[data-chatgpt='account']");
    const password = root.querySelector<HTMLInputElement>("[data-chatgpt='password']");
    const fileInput = root.querySelector<HTMLInputElement>("[data-chatgpt='file']");
    const status = root.querySelector<HTMLElement>("[data-chatgpt='status']");
    const L = window.siyuan.languages;
    let profiles: ChatGPTAccount[] = [];
    let attemptID = "";
    let busy = false;
    let exportedFile = "";
    let timer: number;
    let disposed = false;
    const accountLabel = (account: ChatGPTAccount) =>
        (account.email || account.name || "ChatGPT") + " (" + account.id.slice(-8) + ")";
    const update = () => {
        const selected = profiles.find(item => item.id === draft.accountID);
        root.querySelector<HTMLElement>("[data-chatgpt='accountRow']").classList.toggle("fn__none", profiles.length === 0);
        const accountInfo = root.querySelector<HTMLElement>("[data-chatgpt='accountInfo']");
        accountInfo.textContent = profiles.length === 1 ? accountLabel(profiles[0]) : "";
        accountInfo.classList.toggle("fn__none", profiles.length !== 1);
        picker.classList.toggle("fn__none", profiles.length < 2);
        picker.innerHTML = (selected ? "" : `<option value="" disabled hidden>${escapeHtmlTextAndAttr(L.chatGPTAccount)}</option>`) + profiles.map(item =>
            `<option value="${escapeHtmlTextAndAttr(item.id)}">${escapeHtmlTextAndAttr(accountLabel(item))}</option>`).join("");
        picker.value = draft.accountID || "";
        picker.disabled = busy || !!attemptID;
        root.querySelectorAll<HTMLButtonElement>("button").forEach(button => {
            button.disabled = busy || !!attemptID;
        });
        const cancel = root.querySelector<HTMLButtonElement>("[data-chatgpt='cancel']");
        cancel.classList.toggle("fn__none", !attemptID);
        cancel.disabled = busy;
        root.querySelector<HTMLButtonElement>("[data-chatgpt='add']").classList.toggle("fn__none", profiles.length === 0);
        root.querySelector<HTMLButtonElement>("[data-chatgpt='logout']").classList.toggle("fn__none", !selected?.connected);
        root.querySelector<HTMLButtonElement>("[data-chatgpt='usage']").classList.toggle("fn__none", !selected);
        root.querySelector<HTMLButtonElement>("[data-chatgpt='logout']").disabled ||= !selected?.connected;
        root.querySelector<HTMLButtonElement>("[data-chatgpt='export']").disabled ||= !selected?.connected && !exportedFile;
        for (const action of ["login", "add"]) {
            root.querySelector<HTMLButtonElement>(`[data-chatgpt='${action}']`).disabled ||= !localKernel;
        }
        status.textContent = attemptID ? L.chatGPTSignInPendingTip : selected?.sharing ? L.mcpStatusConnected :
            selected?.connected ? L.mcpStatusAuthorizationRequired : selected ? L.chatGPTSignedOut : "";
        root.querySelector<HTMLElement>("[data-chatgpt='statusRow']").classList.toggle("fn__none", !status.textContent);
        onChange(!!selected?.sharing && !busy && !attemptID);
    };
    const load = async () => {
        await fetchPost("/api/ai/chatgpt/accounts", undefined, response => {
            if (!disposed && response.code === 0) {
                profiles = response.data;
                if (profiles.length === 1 && draft.accountID !== profiles[0].id) {
                    draft.accountID = profiles[0].id;
                    draft.models = [];
                    exportedFile = "";
                }
                update();
            }
        });
    };
    const stop = () => {
        window.clearTimeout(timer);
        const id = attemptID;
        attemptID = "";
        if (id) { void fetchPost("/api/ai/chatgpt/cancel", {id}); }
    };
    const observer = new MutationObserver(() => {
        if (!view.isConnected) { disposed = true; stop(); observer.disconnect(); }
    });
    observer.observe(document.body, {childList: true, subtree: true});
    const poll = async (): Promise<void> => {
        if (disposed || !attemptID) { return; }
        const id = attemptID;
        await fetchPost("/api/ai/chatgpt/status", {id}, async response => {
            if (disposed || attemptID !== id) { return; }
            if (response.code !== 0) { stop(); update(); return; }
            if (response.data.state === "completed") {
                draft.accountID = response.data.accountID;
                attemptID = "";
                draft.models = [];
                await load();
            } else if (response.data.state === "failed") {
                attemptID = "";
                update();
                showMessage(escapeHtmlTextAndAttr(response.data.error), undefined, "error");
            }
        });
        if (attemptID === id && !disposed) { timer = window.setTimeout((): void => { void poll(); }, 1000); }
    };
    picker.addEventListener("change", () => {
        draft.accountID = picker.value;
        draft.models = [];
        exportedFile = "";
        update();
    });
    const transferPassword = () => {
        if (Array.from(password.value).length < 12) {
            password.focus(); showMessage(L.chatGPTTransferTip); return "";
        }
        return password.value;
    };
    root.addEventListener("click", async event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-chatgpt]");
        if (!button || button.disabled) { return; }
        const action = button.dataset.chatgpt;
        if (action === "usage") { openExternal("https://chatgpt.com/settings/usage"); return; }
        if (action === "cancel") { stop(); update(); return; }
        if (action === "import") { if (transferPassword()) { fileInput.click(); } return; }
        let authorizationWindow: Window;
        /// #if BROWSER
        if ((action === "login" || action === "add") && !isInMobileApp()) {
            authorizationWindow = window.open("about:blank", "_blank");
            if (authorizationWindow) { authorizationWindow.opener = null; }
        }
        /// #endif
        busy = true;
        update();
        try {
            if (action === "login" || action === "add") {
                const registered = profiles.some(item => item.id === draft.accountID);
                await fetchPost("/api/ai/chatgpt/start", {accountID: action === "add" || !registered ? "" : draft.accountID}, response => {
                    if (response.code !== 0) { return; }
                    if (disposed) { void fetchPost("/api/ai/chatgpt/cancel", {id: response.data.id}); return; }
                    attemptID = response.data.id;
                    if (authorizationWindow) { authorizationWindow.location.href = response.data.url; }
                    else { openExternal(response.data.url); }
                    timer = window.setTimeout((): void => { void poll(); }, 1000);
                });
            } else if (action === "logout") {
                await fetchPost("/api/ai/chatgpt/logout", {accountID: draft.accountID}, response => {
                    if (response.code === 0 && !response.data.revoked) { showMessage(L.chatGPTRevokeFailed); }
                });
                await load();
            } else if (action === "export") {
                if (!exportedFile) {
                    const secret = transferPassword();
                    if (!secret) { return; }
                    await fetchPost("/api/ai/chatgpt/export", {accountID: draft.accountID, password: secret}, response => {
                        if (response.code === 0) { exportedFile = response.data.file; }
                    });
                    password.value = "";
                    await load();
                }
                if (exportedFile) { await saveExportFile(exportedFile); }
            }
        } finally {
            if (authorizationWindow && !attemptID) { authorizationWindow.close(); }
            busy = false;
            if (!disposed) { update(); }
        }
    });
    fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        const secret = transferPassword();
        if (!file || !secret) { return; }
        if (file.size > 1024 * 1024) { showMessage(L.chatGPTRemoteTip, undefined, "error"); return; }
        busy = true; update();
        try {
            await fetchPost("/api/ai/chatgpt/import", {password: secret, data: await file.text()}, response => {
                if (!disposed && response.code === 0) { draft.accountID = response.data.id; draft.models = []; }
            });
            await load();
        } finally { password.value = ""; fileInput.value = ""; busy = false; if (!disposed) { update(); } }
    });
    void load();
};
