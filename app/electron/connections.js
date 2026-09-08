const {ipcRenderer} = require("electron");
const element = (id) => document.getElementById(id);
const invoke = (cmd, data = {}) => ipcRenderer.invoke("siyuan-connections", {cmd, ...data});
window.initWindowChrome({close: () => invoke("close"), minimize: () => invoke("minimize")});
let languages;
let checked = false;
let authenticated = false;
let sequence = 0;
let history = [];
const selectedOrigin = () => {
    try {
        return new URL(element("origin").value.trim()).origin;
    } catch (error) {
        return "";
    }
};
const restoreTrust = () => {
    element("trust").checked = history.some(entry => entry.origin === selectedOrigin() && entry.trustRemoteExtensions);
};
const message = (value) => { element("message").textContent = value || ""; };
const reset = () => {
    sequence++;
    checked = false;
    authenticated = false;
    element("auth").hidden = true;
    element("captchaRow").hidden = true;
    element("authCode").value = "";
    element("captcha").value = "";
    element("connect").disabled = false;
    message("");
    void invoke("cancel");
};
const refreshCaptcha = async () => {
    const requestSequence = sequence;
    const result = await invoke("captcha", {origin: element("origin").value.trim()});
    if (sequence !== requestSequence) {
        return;
    }
    if (result.image) {
        element("captchaImage").src = result.image;
    } else {
        message(result.error);
    }
};
const renderHistory = (entries) => {
    history = entries;
    element("history").replaceChildren();
    entries.forEach(entry => {
        const row = document.createElement("div");
        row.className = "entry";
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = entry.origin;
        open.addEventListener("click", () => {
            reset();
            element("origin").value = entry.origin;
            restoreTrust();
            element("connectionForm").requestSubmit();
        });
        row.append(open);
        if (entry.mode === "remote") {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = languages.remove;
            remove.addEventListener("click", async () => {
                const result = await invoke("remove", {origin: entry.origin});
                if (result.entries) {
                    renderHistory(result.entries);
                    if (selectedOrigin() === entry.origin) {
                        reset();
                        restoreTrust();
                    }
                }
                message(result.error);
            });
            row.append(remove);
        }
        const trustLabel = document.createElement("label");
        trustLabel.title = languages.trustRemoteExtensionsTip;
        const trust = document.createElement("input");
        trust.type = "checkbox";
        trust.checked = entry.trustRemoteExtensions;
        trustLabel.append(trust, document.createTextNode(languages.trustRemoteExtensions));
        trust.addEventListener("change", async () => {
            trust.disabled = true;
            try {
                const result = await invoke("trust", {origin: entry.origin, trustRemoteExtensions: trust.checked});
                if (result.entries) {
                    renderHistory(result.entries);
                    if (selectedOrigin() === entry.origin) {
                        reset();
                        restoreTrust();
                    }
                } else {
                    trust.checked = entry.trustRemoteExtensions;
                }
                message(result.error);
            } catch (error) {
                trust.checked = entry.trustRemoteExtensions;
                message(String(error.message));
            } finally {
                trust.disabled = false;
            }
        });
        element("history").append(row, trustLabel);
    });
};
element("origin").addEventListener("input", () => {
    reset();
    restoreTrust();
});
element("trust").addEventListener("change", reset);
ipcRenderer.on("siyuan-connection-target", (event, data) => {
    reset();
    if (data.origin) {
        element("origin").value = data.origin;
    }
    restoreTrust();
    message(data.error);
    element("origin").focus();
});
element("cancel").addEventListener("click", reset);
element("refreshCaptcha").addEventListener("click", refreshCaptcha);
element("connectionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const requestSequence = ++sequence;
    const origin = element("origin").value.trim();
    const trustRemoteExtensions = element("trust").checked;
    element("connect").disabled = true;
    message(languages.checkingRemoteKernel);
    try {
        let result;
        if (!checked) {
            result = await invoke("check", {origin});
        } else if (!authenticated) {
            result = await invoke("login", {origin, authCode: element("authCode").value.trim(),
                captcha: element("captcha").value, rememberMe: element("rememberMe").checked});
            element("authCode").value = "";
        } else {
            result = {authenticated: true};
        }
        if (sequence !== requestSequence) {
            return;
        }
        if (typeof result.authenticated === "boolean") {
            checked = true;
            authenticated = result.authenticated;
        }
        if (authenticated) {
            message((await invoke("open", {origin, trustRemoteExtensions})).error || languages.switchConnectionRestartTip);
        } else {
            message(result.error);
            element("auth").hidden = !checked;
            if (result.captcha) {
                element("captchaRow").hidden = false;
                await refreshCaptcha();
            }
            if (checked) {
                element("authCode").focus();
            }
        }
    } catch (error) {
        if (sequence === requestSequence) {
            message(String(error.message));
        }
    } finally {
        if (sequence === requestSequence) {
            element("connect").disabled = false;
        }
    }
});
void invoke("init").then(result => {
    if (!result.languages) {
        message(result.error);
        return;
    }
    languages = result.languages;
    document.documentElement.lang = result.lang;
    document.documentElement.dir = ["ar", "he"].includes(result.lang) ? "rtl" : "ltr";
    document.title = languages.connectRemoteKernel;
    element("title").textContent = languages.connectRemoteKernel;
    element("addressLabel").textContent = languages.remoteConnection;
    element("addressTip").textContent = languages.remoteKernelAddressTip;
    element("trustLabel").textContent = languages.trustRemoteExtensions;
    element("trustTip").textContent = languages.trustRemoteExtensionsTip;
    element("restartTip").textContent = languages.switchConnectionRestartTip;
    element("connect").textContent = languages.connect;
    element("cancel").textContent = languages.cancel;
    element("historyTitle").textContent = languages.remoteConnectionHistory;
    element("authCode").placeholder = languages._kernel["173"];
    element("authCode").ariaLabel = languages._kernel["173"];
    element("captcha").placeholder = languages._kernel["175"];
    element("captcha").ariaLabel = languages._kernel["175"];
    element("refreshCaptcha").ariaLabel = languages.refresh;
    element("rememberLabel").textContent = languages._kernel["257"];
    element("origin").value = result.origin;
    message(result.error);
    renderHistory(result.entries);
    restoreTrust();
});
