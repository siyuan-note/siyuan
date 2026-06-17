import {fetchPost} from "../util/fetch";

function getDefaultModel() {
    const p = window.siyuan.config.ai.providers[0];
    if (!p) {
        return {name: ""};
    }
    const m = p.models[0];
    if (!m) {
        return {name: ""};
    }
    return m;
}

function getDefaultProvider() {
    const p = window.siyuan.config.ai.providers[0];
    if (!p) {
        return {apiKey: "", baseURL: "https://api.openai.com/v1", requestTimeout: 30};
    }
    return p;
}

function getDefaultEditing() {
    return window.siyuan.config.ai.editing || {
        maxHistoryMessages: 7,
        temperature: 1.0,
        maxCompletionTokens: 0,
    };
}

export const ai = {
    element: undefined as Element,
    genHTML: () => {
        const model = getDefaultModel();
        const prov = getDefaultProvider();
        const editing = getDefaultEditing();
        const agent = window.siyuan.config.ai.agent || {sessionTimeout: 600, confirmTimeout: 120, maxRetries: 3};
        let responsiveHTML = "";
        /// #if MOBILE
        responsiveHTML = `<div class="b3-label">
    ${window.siyuan.languages.apiBaseURL}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__block" id="apiBaseURL" value="${prov.baseURL || "https://api.openai.com/v1"}"/>
    <div class="b3-label__text">${window.siyuan.languages.apiBaseURLTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiKey}
    <div class="fn__hr"></div>
    <div class="b3-form__icona fn__block">
        <input id="apiKey" type="password" class="b3-text-field b3-form__icona-input" value="${prov.apiKey}">
        <svg class="b3-form__icona-icon" data-action="togglePassword"><use xlink:href="#iconEye"></use></svg>
    </div>
    <div class="b3-label__text">${window.siyuan.languages.apiKeyTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiTimeout}
    <div class="fn__hr"></div>
    <div class="fn__flex">
        <input class="b3-text-field fn__flex-1" type="number" step="1" min="1" max="600" id="apiTimeout" value="${prov.requestTimeout || 30}"/>
        <span class="fn__space"></span>
        <span class="ft__on-surface fn__flex-center">s</span>
    </div>
    <div class="b3-label__text">${window.siyuan.languages.apiTimeoutTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiModel}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__block" id="apiModel" value="${model.name}"/>
    <div class="b3-label__text">${window.siyuan.languages.apiModelTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiMaxTokens}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" type="number" step="1" min="0" id="chatMaxCompletionTokens" value="${editing.maxCompletionTokens || 0}"/>
    <div class="b3-label__text">${window.siyuan.languages.apiMaxTokensTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiTemperature}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" type="number" step="0.1" min="0" max="2" id="chatTemperature" value="${editing.temperature || 1.0}"/>
    <div class="b3-label__text">${window.siyuan.languages.apiTemperatureTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiMaxContexts}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" type="number" step="1" min="1" max="64" id="chatMaxHistoryMessages" value="${editing.maxHistoryMessages || 7}"/>
    <div class="b3-label__text">${window.siyuan.languages.apiMaxContextsTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.agentTimeout || "Agent Timeout"}
    <div class="fn__hr"></div>
    <div class="fn__flex">
        <input class="b3-text-field fn__flex-1" type="number" step="1" min="0" id="agentTimeout" value="${agent.sessionTimeout || 600}"/>
        <span class="fn__space"></span>
        <span class="ft__on-surface fn__flex-center">s</span>
    </div>
    <div class="b3-label__text">${window.siyuan.languages.agentTimeoutTip || "0 = no limit"}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.agentConfirmTimeout || "Confirm Timeout"}
    <div class="fn__hr"></div>
    <div class="fn__flex">
        <input class="b3-text-field fn__flex-1" type="number" step="1" min="10" max="600" id="agentConfirmTimeout" value="${agent.confirmTimeout || 120}"/>
        <span class="fn__space"></span>
        <span class="ft__on-surface fn__flex-center">s</span>
    </div>
    <div class="b3-label__text">${window.siyuan.languages.agentConfirmTimeoutTip || "Auto reject after timeout"}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.agentMaxRetries || "Max Retries"}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" type="number" step="1" min="0" max="10" id="agentMaxRetries" value="${agent.maxRetries || 3}"/>
    <div class="b3-label__text">${window.siyuan.languages.agentMaxRetriesTip || "Max API retry attempts on failure"}</div>
</div>`;
        /// #else
        responsiveHTML = `<div class="fn__flex b3-label">
    <div class="fn__block">
        ${window.siyuan.languages.apiBaseURL}
        <div class="b3-label__text">${window.siyuan.languages.apiBaseURLTip}</div>
        <span class="fn__hr"></span>
        <input class="b3-text-field fn__block" id="apiBaseURL" value="${prov.baseURL || ""}"/>
    </div>
</div>
<div class="fn__flex b3-label">
    <div class="fn__block">
        ${window.siyuan.languages.apiKey}
        <div class="b3-label__text">${window.siyuan.languages.apiKeyTip}</div>
        <div class="fn__hr"></div>
        <div class="b3-form__icona fn__block">
            <input id="apiKey" type="password" class="b3-text-field b3-form__icona-input" value="${prov.apiKey}">
            <svg class="b3-form__icona-icon" data-action="togglePassword"><use xlink:href="#iconEye"></use></svg>
        </div>
    </div>
</div>
<div class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiTimeout}
        <div class="b3-label__text">${window.siyuan.languages.apiTimeoutTip}</div>
    </div>
    <span class="fn__space"></span>
    <div class="fn__size200 fn__flex-center fn__flex">
        <input class="b3-text-field fn__flex-1" type="number" step="1" min="1" max="600" id="apiTimeout" value="${prov.requestTimeout || 30}"/>
        <span class="fn__space"></span>
        <span class="ft__on-surface fn__flex-center">s</span>
    </div>
</div>
<div class="fn__flex b3-label">
    <div class="fn__block">
        ${window.siyuan.languages.apiModel}
        <div class="b3-label__text">${window.siyuan.languages.apiModelTip}</div>
        <div class="fn__hr"></div>
        <input class="b3-text-field fn__block" id="apiModel" value="${model.name}"/>
    </div>
</div>
<div class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiMaxTokens}
        <div class="b3-label__text">${window.siyuan.languages.apiMaxTokensTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" type="number" step="1" min="0" id="chatMaxCompletionTokens" value="${editing.maxCompletionTokens || 0}"/>
</div>
<div class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiTemperature}
        <div class="b3-label__text">${window.siyuan.languages.apiTemperatureTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" type="number" step="0.1" min="0" max="2" id="chatTemperature" value="${editing.temperature || 1.0}"/>
</div>
<div class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiMaxContexts}
        <div class="b3-label__text">${window.siyuan.languages.apiMaxContextsTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" type="number" step="1" min="1" max="64" id="chatMaxHistoryMessages" value="${editing.maxHistoryMessages || 7}"/>
</div>
<div class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.agentTimeout || "Agent Timeout"}
        <div class="b3-label__text">${window.siyuan.languages.agentTimeoutTip || "0 = no limit"}</div>
    </div>
    <span class="fn__space"></span>
    <div class="fn__size200 fn__flex-center fn__flex">
        <input class="b3-text-field fn__flex-1" type="number" step="1" min="0" id="agentTimeout" value="${agent.sessionTimeout || 600}"/>
        <span class="fn__space"></span>
        <span class="ft__on-surface fn__flex-center">s</span>
    </div>
</div>
<div class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.agentConfirmTimeout || "Confirm Timeout"}
        <div class="b3-label__text">${window.siyuan.languages.agentConfirmTimeoutTip || "Auto reject after timeout"}</div>
    </div>
    <span class="fn__space"></span>
    <div class="fn__size200 fn__flex-center fn__flex">
        <input class="b3-text-field fn__flex-1" type="number" step="1" min="10" max="600" id="agentConfirmTimeout" value="${agent.confirmTimeout || 120}"/>
        <span class="fn__space"></span>
        <span class="ft__on-surface fn__flex-center">s</span>
    </div>
</div>
<div class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.agentMaxRetries || "Max Retries"}
        <div class="b3-label__text">${window.siyuan.languages.agentMaxRetriesTip || "Max API retry attempts on failure"}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" type="number" step="1" min="0" max="10" id="agentMaxRetries" value="${agent.maxRetries || 3}"/>
</div>`;
        /// #endif
        return responsiveHTML;
    },
    bindEvent: () => {
        const togglePassword = ai.element.querySelector('.b3-form__icona-icon[data-action="togglePassword"]');
        if (togglePassword) {
            togglePassword.addEventListener("click", () => {
                const isEye = togglePassword.firstElementChild.getAttribute("xlink:href") === "#iconEye";
                togglePassword.firstElementChild.setAttribute("xlink:href", isEye ? "#iconEyeoff" : "#iconEye");
                togglePassword.previousElementSibling.setAttribute("type", isEye ? "text" : "password");
            });
        }
        ai.element.querySelectorAll("input, select").forEach((item) => {
            item.addEventListener("change", () => {
                const providers = window.siyuan.config.ai.providers;
                const firstProvider: Config.IProvider = providers[0] ?? {
                    id: "",
                    apiKey: "",
                    baseURL: "",
                    requestTimeout: 30,
                    enabled: true,
                    models: [] as Config.IModel[],
                };
                const firstModel = firstProvider.models[0] ?? {id: "", name: "", enabled: true};
                const editing = window.siyuan.config.ai.editing;
                fetchPost("/api/setting/setAI", {
                    providers: [{
                        id: firstProvider.id,
                        enabled: firstProvider.enabled,
                        apiKey: (ai.element.querySelector("#apiKey") as HTMLInputElement)?.value || firstProvider.apiKey || "",
                        baseURL: (ai.element.querySelector("#apiBaseURL") as HTMLInputElement)?.value || firstProvider.baseURL || "",
                        requestTimeout: parseInt((ai.element.querySelector("#apiTimeout") as HTMLInputElement)?.value) || firstProvider.requestTimeout || 30,
                        models: [{
                            id: firstModel.id,
                            enabled: firstModel.enabled,
                            name: (ai.element.querySelector("#apiModel") as HTMLInputElement)?.value || firstModel.name || "",
                        }]
                    }],
                    editing: {
                        maxCompletionTokens: parseInt((ai.element.querySelector("#chatMaxCompletionTokens") as HTMLInputElement)?.value) || 0,
                        temperature: parseFloat((ai.element.querySelector("#chatTemperature") as HTMLInputElement)?.value) || editing.temperature || 1.0,
                        maxHistoryMessages: parseInt((ai.element.querySelector("#chatMaxHistoryMessages") as HTMLInputElement)?.value) || editing.maxHistoryMessages || 7,
                    },
                    agent: {
                        sessionTimeout: parseInt((ai.element.querySelector("#agentTimeout") as HTMLInputElement)?.value) || 600,
                        confirmTimeout: parseInt((ai.element.querySelector("#agentConfirmTimeout") as HTMLInputElement)?.value) || 120,
                        maxRetries: parseInt((ai.element.querySelector("#agentMaxRetries") as HTMLInputElement)?.value) || 3,
                    }
                }, response => {
                    window.siyuan.config.ai = response.data;
                });
            });
        });
    },
};
