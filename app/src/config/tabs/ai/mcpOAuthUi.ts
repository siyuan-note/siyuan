import {fetchSyncPost} from "../../../util/fetch";
import {showMessage} from "../../../dialog/message";

export const genMcpOAuthHtml = () => "<div class=\"b3-label config-item\" id=\"mcpOAuthSettings\"></div>";

export const mountMcpOAuth = (root: HTMLElement) => {
    const block = root.querySelector<HTMLElement>("#mcpOAuthSettings");
    if (!block) {
        return;
    }
    const lang = window.siyuan.languages;
    const escape = Lute.EscapeHTMLStr;
    const input = (field: string, label: string, value = "", readonly = false) =>
        `<label class="fn__block">${escape(label)}<input class="b3-text-field fn__block" data-field="${field}" value="${escape(value)}" ${readonly ? "readonly" : ""} spellcheck="false"></label><div class="fn__hr"></div>`;

    const render = async () => {
        const response = await fetchSyncPost("/api/mcp/getOAuth", {});
        if (response.code !== 0 || !block.isConnected) {
            return;
        }
        const status = response.data;
        block.innerHTML = `<div class="b3-label__text">${escape(lang.mcpOAuthServer)}</div>
<div class="b3-label__text ft__on-surface">${escape(lang.mcpOAuthTip)}</div><div class="fn__hr"></div>
<label class="fn__flex"><span class="fn__flex-1">${escape(lang.mcpOAuthServer)}</span><input class="b3-switch" type="checkbox" data-field="enabled" ${status.enabled ? "checked" : ""}></label><div class="fn__hr"></div>
${input("publicURL", lang.mcpOAuthPublicURL, status.publicURL)}
<button class="b3-button b3-button--outline" data-action="save">${escape(lang.save)}</button>
<button class="b3-button b3-button--outline" data-action="revoke">${escape(lang.mcpOAuthRevokeAll)}</button><div class="fn__hr"></div>
${status.publicURL ? input("endpoint", lang.mcpOAuthEndpoint, status.publicURL + "/mcp", true) : ""}
${input("name", lang.name)}${input("redirectURI", lang.mcpOAuthRedirectURI)}
<button class="b3-button b3-button--outline" data-action="register">${escape(lang.mcpOAuthRegister)}</button>
<div data-secret></div><div class="fn__hr"></div>
${status.clients.map(client => `<div class="fn__hr"></div><div class="fn__flex"><span class="fn__flex-1">${escape(client.name)}</span><button class="b3-button b3-button--outline" data-action="remove" data-id="${escape(client.id)}">${escape(lang.remove)}</button></div>
${input("clientID", lang.mcpOAuthClientID, client.id, true)}${input("callback", lang.mcpOAuthRedirectURI, client.redirectURI, true)}`).join("")}`;
        setDisabled(Boolean(window.siyuan.config.readonly));
    };
    const setDisabled = (disabled: boolean) => {
        block.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input:not([readonly]), button").forEach(element => {
            element.disabled = disabled;
        });
    };
    const value = (field: string) => block.querySelector<HTMLInputElement>(`[data-field="${field}"]`).value.trim();
    block.addEventListener("click", async event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
        if (!button || button.disabled || window.siyuan.config.readonly) {
            return;
        }
        setDisabled(true);
        try {
            const action = button.dataset.action;
            if (action === "register") {
                const response = await fetchSyncPost("/api/mcp/addOAuthClient", {name: value("name"), redirectURI: value("redirectURI")});
                if (response.code === 0 && block.isConnected) {
                    await render();
                    const secret = block.querySelector<HTMLElement>("[data-secret]");
                    secret.innerHTML = `<div class="fn__hr"></div><p>${escape(lang.mcpOAuthSecretTip)}</p>${input("newClientID", lang.mcpOAuthClientID, response.data.id, true)}${input("newClientSecret", lang.mcpOAuthClientSecret, response.data.secret, true)}`;
                }
            } else if (action === "save") {
                const response = await fetchSyncPost("/api/mcp/setOAuth", {
                    enabled: block.querySelector<HTMLInputElement>("[data-field='enabled']").checked,
                    publicURL: value("publicURL"),
                });
                if (response.code === 0) {
                    await render();
                }
            } else {
                const response = await fetchSyncPost("/api/mcp/removeOAuthClient", {id: button.dataset.id || "", all: action === "revoke"});
                if (response.code === 0) {
                    await render();
                }
            }
        } catch (error) {
            showMessage(lang.mcpOAuthError);
        } finally {
            setDisabled(Boolean(window.siyuan.config.readonly));
        }
    });
    void render().catch(() => showMessage(lang.mcpOAuthError));
};
