import {ipcRenderer} from "electron";
import {Dialog} from "./index";
import {escapeAttr, escapeHtml} from "../util/escape";

let activeDialog: Dialog;

export const openRemoteConnection = (initialOrigin = "") => {
    if (activeDialog) {
        activeDialog.element.querySelector<HTMLInputElement>("[data-field='origin']").focus();
        return;
    }
    const languages = window.siyuan.languages;
    const invoke = (cmd: string, data = {}) => ipcRenderer.invoke("siyuan-connections", {cmd, ...data});
    let sequence = 0;
    let closed = false;
    let checked = false;
    let authenticated = false;
    let initialized = false;
    let history: {origin: string, trustRemoteExtensions: boolean}[] = [];
    const dialog = new Dialog({
        title: escapeHtml(languages.connectRemoteKernel),
        width: "600px",
        content: `<div class="b3-dialog__content" style="word-break:normal;overflow-wrap:anywhere">
    <div class="ft__on-surface">${escapeHtml(languages.switchConnectionRestartTip)}</div>
    <div class="fn__hr"></div>
    <form>
        <input data-field="origin" class="b3-text-field fn__block" type="url" placeholder="https://siyuan.example.com" required aria-label="${escapeAttr(escapeHtml(languages.remoteConnection))}">
        <div class="fn__hr"></div>
        <div class="ft__on-surface">${escapeHtml(languages.remoteKernelAddressTip)}</div>
        <div class="fn__hr"></div>
        <label class="fn__flex" style="align-items:center"><input data-field="trust" type="checkbox" class="b3-switch"><span class="fn__space"></span>${escapeHtml(languages.trustRemoteExtensions)}</label>
        <div class="fn__hr"></div>
        <div class="ft__on-surface">${escapeHtml(languages.trustRemoteExtensionsTip)}</div>
        <div data-field="auth" class="fn__none">
            <div class="fn__hr"></div>
            <input data-field="authCode" class="b3-text-field fn__block" type="password" autocomplete="current-password">
            <div data-field="captchaRow" class="fn__none">
                <div class="fn__hr"></div>
                <div class="fn__flex">
                    <input data-field="captcha" class="b3-text-field fn__flex-1" autocomplete="off">
                    <div class="fn__space"></div>
                    <button data-field="refreshCaptcha" class="b3-button b3-button--outline" type="button"><img data-field="captchaImage"></button>
                </div>
            </div>
            <div class="fn__hr"></div>
            <label class="fn__flex" style="align-items:center"><input data-field="rememberMe" type="checkbox" class="b3-switch"><span class="fn__space"></span><span data-field="rememberLabel"></span></label>
        </div>
        <button type="submit" class="fn__none" tabindex="-1"></button>
    </form>
    <div data-field="message" class="ft__error" style="white-space:pre-wrap;margin-top:8px" role="status" aria-live="polite"></div>
    <div data-field="historySection" class="fn__none">
        <div class="fn__hr"></div>
        <div class="ft__on-surface">${escapeHtml(languages.remoteConnectionHistory)}</div>
        <div data-field="history" class="b3-list" style="max-height:200px;overflow:auto"></div>
    </div>
</div>
<div class="b3-dialog__action">
    <button data-field="cancel" class="b3-button b3-button--cancel">${escapeHtml(languages.cancel)}</button>
    <div class="fn__space"></div>
    <button data-field="connect" class="b3-button b3-button--text" disabled>${escapeHtml(languages.connectRemoteKernel)}</button>
</div>`,
        destroyCallback: () => {
            closed = true;
            sequence++;
            activeDialog = undefined;
            void invoke("close");
        },
    });
    activeDialog = dialog;
    const field = <T extends HTMLElement = HTMLElement>(name: string) =>
        dialog.element.querySelector<T>(`[data-field="${name}"]`);
    const origin = field<HTMLInputElement>("origin");
    const authCode = field<HTMLInputElement>("authCode");
    const captcha = field<HTMLInputElement>("captcha");
    const connect = field<HTMLButtonElement>("connect");
    const trust = field<HTMLInputElement>("trust");
    const selectedOrigin = () => {
        try {
            return new URL(origin.value.trim()).origin;
        } catch (error) {
            return "";
        }
    };
    const restoreTrust = () => {
        trust.checked = history.some(entry => entry.origin === selectedOrigin() && entry.trustRemoteExtensions);
    };
    const form = dialog.element.querySelector("form");
    const message = (value = "", error = true) => {
        field("message").textContent = value;
        field("message").classList.toggle("ft__error", error);
    };
    const reset = () => {
        sequence++;
        checked = false;
        authenticated = false;
        field("auth").classList.add("fn__none");
        field("captchaRow").classList.add("fn__none");
        authCode.value = "";
        captcha.value = "";
        connect.disabled = !initialized;
        message();
        void invoke("cancel");
    };
    const refreshCaptcha = async () => {
        const requestSequence = sequence;
        try {
            const result = await invoke("captcha", {origin: origin.value.trim()});
            if (closed || sequence !== requestSequence) {
                return;
            }
            if (result.image) {
                field<HTMLImageElement>("captchaImage").src = result.image;
            } else {
                message(result.error);
            }
        } catch (error) {
            if (!closed && sequence === requestSequence) {
                message(String(error.message));
            }
        }
    };
    const renderHistory = (entries: {origin: string, trustRemoteExtensions: boolean}[]) => {
        history = entries;
        field("historySection").classList.toggle("fn__none", entries.length === 0);
        field("history").replaceChildren();
        entries.forEach(entry => {
            const row = document.createElement("div");
            row.className = "fn__flex";
            const open = document.createElement("button");
            open.className = "b3-list-item fn__flex-1";
            open.textContent = entry.origin;
            open.addEventListener("click", () => {
                reset();
                origin.value = entry.origin;
                restoreTrust();
                form.requestSubmit();
            });
            const trustLabel = document.createElement("label");
            trustLabel.className = "fn__flex";
            trustLabel.style.alignItems = "center";
            trustLabel.title = languages.trustRemoteExtensionsTip;
            const trustEntry = document.createElement("input");
            trustEntry.type = "checkbox";
            trustEntry.className = "b3-switch";
            trustEntry.checked = entry.trustRemoteExtensions;
            const space = document.createElement("span");
            space.className = "fn__space";
            trustLabel.append(trustEntry, space, document.createTextNode(languages.trustRemoteExtensions));
            trustEntry.addEventListener("change", async () => {
                trustEntry.disabled = true;
                try {
                    const result = await invoke("trust", {origin: entry.origin, trustRemoteExtensions: trustEntry.checked});
                    if (!closed) {
                        if (result.entries) {
                            renderHistory(result.entries);
                            if (selectedOrigin() === entry.origin) {
                                reset();
                                restoreTrust();
                            }
                        } else {
                            trustEntry.checked = entry.trustRemoteExtensions;
                        }
                        message(result.error);
                    }
                } catch (error) {
                    trustEntry.checked = entry.trustRemoteExtensions;
                    message(String(error.message));
                } finally {
                    trustEntry.disabled = false;
                }
            });
            const remove = document.createElement("button");
            remove.className = "b3-button b3-button--outline";
            remove.textContent = languages.remove;
            remove.addEventListener("click", async () => {
                try {
                    const result = await invoke("remove", {origin: entry.origin});
                    if (!closed) {
                        if (result.entries) {
                            renderHistory(result.entries);
                            if (selectedOrigin() === entry.origin) {
                                reset();
                                restoreTrust();
                            }
                        }
                        message(result.error);
                    }
                } catch (error) {
                    if (!closed) {
                        message(String(error.message));
                    }
                }
            });
            row.append(open, remove);
            field("history").append(row, trustLabel);
        });
    };
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (connect.disabled || closed) {
            return;
        }
        const requestSequence = ++sequence;
        const address = origin.value.trim();
        const trustRemoteExtensions = trust.checked;
        connect.disabled = true;
        message(languages.checkingRemoteKernel, false);
        try {
            let result;
            if (!checked) {
                result = await invoke("check", {origin: address});
            } else if (!authenticated) {
                result = await invoke("login", {origin: address, authCode: authCode.value.trim(),
                    captcha: captcha.value, rememberMe: field<HTMLInputElement>("rememberMe").checked});
                authCode.value = "";
            } else {
                result = {authenticated: true};
            }
            if (closed || sequence !== requestSequence) {
                return;
            }
            if (typeof result.authenticated === "boolean") {
                checked = true;
                authenticated = result.authenticated;
            }
            if (authenticated) {
                const opened = await invoke("open", {origin: address, trustRemoteExtensions});
                if (!closed && sequence === requestSequence) {
                    message(opened.error || languages.switchConnectionRestartTip, !!opened.error);
                }
            } else {
                message(result.error);
                field("auth").classList.toggle("fn__none", !checked);
                if (result.captcha) {
                    field("captchaRow").classList.remove("fn__none");
                    await refreshCaptcha();
                }
                if (!closed && checked) {
                    authCode.focus();
                }
            }
        } catch (error) {
            if (!closed && sequence === requestSequence) {
                message(String(error.message));
            }
        } finally {
            if (!closed && sequence === requestSequence) {
                connect.disabled = false;
            }
        }
    });
    origin.addEventListener("input", () => {
        reset();
        restoreTrust();
    });
    trust.addEventListener("change", reset);
    field("cancel").addEventListener("click", () => dialog.destroy());
    field("refreshCaptcha").addEventListener("click", refreshCaptcha);
    connect.addEventListener("click", () => form.requestSubmit());
    [origin, authCode, captcha].forEach(input => dialog.bindInput(input, () => form.requestSubmit()));
    origin.value = initialOrigin;
    origin.focus();
    void invoke("init", {dialog: true, lang: window.siyuan.config.lang, origin: initialOrigin}).then(result => {
        if (closed) {
            return;
        }
        if (!result.languages) {
            message(result.error);
            return;
        }
        authCode.placeholder = result.languages._kernel["173"];
        authCode.ariaLabel = authCode.placeholder;
        captcha.placeholder = result.languages._kernel["175"];
        captcha.ariaLabel = captcha.placeholder;
        field("refreshCaptcha").ariaLabel = languages.refresh;
        field("rememberLabel").textContent = result.languages._kernel["257"];
        origin.value = result.origin;
        message(result.error);
        renderHistory(result.entries);
        restoreTrust();
        initialized = true;
        connect.disabled = false;
    }).catch(error => {
        if (!closed) {
            message(String(error.message));
        }
    });
};
