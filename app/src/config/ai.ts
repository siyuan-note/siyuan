import {fetchPost} from "../util/fetch";

export const ai = {
    element: undefined as Element,
    genHTML: () => {
        let responsiveHTML = "";
        /// #if MOBILE
        responsiveHTML = `<div class="b3-label">
    ${window.siyuan.languages.apiProvider}
    <div class="b3-label__text">
        ${window.siyuan.languages.apiProviderTip}
    </div>
    <div class="b3-label__text fn__flex config__item">
        <select id="apiProvider" class="b3-select">
            <option value="OpenAI" ${window.siyuan.config.ai.openAI.apiProvider === "OpenAI" ? "selected" : ""}>OpenAI</option>
            <option value="Azure" ${window.siyuan.config.ai.openAI.apiProvider === "Azure" ? "selected" : ""}>Azure</option>
        </select>
    </div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiTimeout}
    <div class="fn__hr"></div>
    <div class="fn__flex">
        <input class="b3-text-field fn__flex-1" type="number" step="1" min="5" max="600" id="apiTimeout" value="${window.siyuan.config.ai.openAI.apiTimeout}"/>
        <span class="fn__space"></span>
        <span class="ft__on-surface fn__flex-center">s</span>
    </div>
    <div class="b3-label__text">${window.siyuan.languages.apiTimeoutTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiMaxTokens}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" type="number" step="1" min="0" id="apiMaxTokens" value="${window.siyuan.config.ai.openAI.apiMaxTokens}"/>
    <div class="b3-label__text">${window.siyuan.languages.apiMaxTokensTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiTemperature}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" type="number" step="0.1" min="0" max="2" id="apiTemperature" value="${window.siyuan.config.ai.openAI.apiTemperature}"/>
    <div class="b3-label__text">${window.siyuan.languages.apiTemperatureTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiMaxContexts}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" type="number" step="1" min="1" max="64" id="apiMaxContexts" value="${window.siyuan.config.ai.openAI.apiMaxContexts}"/>
    <div class="b3-label__text">${window.siyuan.languages.apiMaxContextsTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiModel}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__block" id="apiModel" value="${window.siyuan.config.ai.openAI.apiModel}"/>
    <div class="b3-label__text">${window.siyuan.languages.apiModelTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiKey}
    <div class="fn__hr"></div>
    <div class="b3-form__icona fn__block">
        <input id="apiKey" type="password" class="b3-text-field b3-form__icona-input" value="${window.siyuan.config.ai.openAI.apiKey}">
        <svg class="b3-form__icona-icon" data-action="togglePassword"><use xlink:href="#iconEye"></use></svg>
    </div>
    <div class="b3-label__text">${window.siyuan.languages.apiKeyTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiProxy}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__block" id="apiProxy" value="${window.siyuan.config.ai.openAI.apiProxy}"/>
    <div class="b3-label__text">${window.siyuan.languages.apiProxyTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiBaseURL}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__block" id="apiBaseURL" value="${window.siyuan.config.ai.openAI.apiBaseURL}"/>
    <div class="b3-label__text">${window.siyuan.languages.apiBaseURLTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiVersion}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__block" id="apiVersion" value="${window.siyuan.config.ai.openAI.apiVersion}"/>
    <div class="b3-label__text">${window.siyuan.languages.apiVersionTip}</div>
</div>
<div class="b3-label">
    User-Agent
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__block" id="apiUserAgent" value="${window.siyuan.config.ai.openAI.apiUserAgent}"/>
    <div class="b3-label__text">${window.siyuan.languages.apiUserAgentTip}</div>
</div>`;
        /// #else
        responsiveHTML = `<div class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiProvider}
        <div class="b3-label__text">${window.siyuan.languages.apiProviderTip}</div>
    </div>
    <span class="fn__space"></span>
    <select id="apiProvider" class="b3-select fn__flex-center fn__size200">
        <option value="OpenAI" ${window.siyuan.config.ai.openAI.apiProvider === "OpenAI" ? "selected" : ""}>OpenAI</option>
        <option value="Azure" ${window.siyuan.config.ai.openAI.apiProvider === "Azure" ? "selected" : ""}>Azure</option>
    </select>
</div>
<div class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiTimeout}
        <div class="b3-label__text">${window.siyuan.languages.apiTimeoutTip}</div>
    </div>
    <span class="fn__space"></span>
    <div class="fn__size200 fn__flex-center fn__flex">
        <input class="b3-text-field fn__flex-1" type="number" step="1" min="5" max="600" id="apiTimeout" value="${window.siyuan.config.ai.openAI.apiTimeout}"/>
        <span class="fn__space"></span>
        <span class="ft__on-surface fn__flex-center">s</span>
    </div>
</div>
<div class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiMaxTokens}
        <div class="b3-label__text">${window.siyuan.languages.apiMaxTokensTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" type="number" step="1" min="0" id="apiMaxTokens" value="${window.siyuan.config.ai.openAI.apiMaxTokens}"/>
</div>
<div class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiTemperature}
        <div class="b3-label__text">${window.siyuan.languages.apiTemperatureTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" type="number" step="0.1" min="0" max="2" id="apiTemperature" value="${window.siyuan.config.ai.openAI.apiTemperature}"/>
</div>
<div class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiMaxContexts}
        <div class="b3-label__text">${window.siyuan.languages.apiMaxContextsTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" type="number" step="1" min="1" max="64" id="apiMaxContexts" value="${window.siyuan.config.ai.openAI.apiMaxContexts}"/>
</div>
<div class="fn__flex b3-label">
    <div class="fn__block">
        ${window.siyuan.languages.apiModel}
        <div class="b3-label__text">${window.siyuan.languages.apiModelTip}</div>
        <div class="fn__hr"></div>
        <input class="b3-text-field fn__block" id="apiModel" value="${window.siyuan.config.ai.openAI.apiModel}"/>
    </div>
</div>
<div class="fn__flex b3-label">
    <div class="fn__block">
        ${window.siyuan.languages.apiKey}
        <div class="b3-label__text">${window.siyuan.languages.apiKeyTip}</div>
        <div class="fn__hr"></div>
        <div class="b3-form__icona fn__block">
            <input id="apiKey" type="password" class="b3-text-field b3-form__icona-input" value="${window.siyuan.config.ai.openAI.apiKey}">
            <svg class="b3-form__icona-icon" data-action="togglePassword"><use xlink:href="#iconEye"></use></svg>
        </div>
    </div>
</div>
<div class="fn__flex b3-label">
    <div class="fn__block">
        ${window.siyuan.languages.apiProxy}
        <div class="b3-label__text">${window.siyuan.languages.apiProxyTip}</div>
        <span class="fn__hr"></span>
        <input class="b3-text-field fn__block" id="apiProxy" value="${window.siyuan.config.ai.openAI.apiProxy}"/>
    </div>
</div>
<div class="fn__flex b3-label">
    <div class="fn__block">
        ${window.siyuan.languages.apiBaseURL}
        <div class="b3-label__text">${window.siyuan.languages.apiBaseURLTip}</div>
        <span class="fn__hr"></span>
        <input class="b3-text-field fn__block" id="apiBaseURL" value="${window.siyuan.config.ai.openAI.apiBaseURL}"/>
    </div>
</div>
<div class="fn__flex b3-label">
    <div class="fn__block">
        ${window.siyuan.languages.apiVersion}
        <div class="b3-label__text">${window.siyuan.languages.apiVersionTip}</div>
        <span class="fn__hr"></span>
        <input class="b3-text-field fn__block" id="apiVersion" value="${window.siyuan.config.ai.openAI.apiVersion}"/>
    </div>
</div>
<div class="fn__flex b3-label">
    <div class="fn__block">
        User-Agent
        <div class="b3-label__text">${window.siyuan.languages.apiUserAgentTip}</div>
        <span class="fn__hr"></span>
        <input class="b3-text-field fn__block" id="apiUserAgent" value="${window.siyuan.config.ai.openAI.apiUserAgent}"/>
    </div>
</div>`;
        /// #endif
        return `<div class="fn__flex-column" style="height: 100%">
<div class="layout-tab-bar fn__flex">
    <div data-type="openai" class="item item--full item--focus"><span class="fn__flex-1"></span><span class="item__text">OpenAI</span><span class="fn__flex-1"></span></div>
</div>
<div class="fn__flex-1">
    <div data-type="openai">
        ${responsiveHTML}
    </div>
</div>
</div>`;
    },
    bindEvent: () => {
        const togglePassword = ai.element.querySelector('.b3-form__icona-icon[data-action="togglePassword"]');
        togglePassword.addEventListener("click", () => {
            const isEye = togglePassword.firstElementChild.getAttribute("xlink:href") === "#iconEye";
            togglePassword.firstElementChild.setAttribute("xlink:href", isEye ? "#iconEyeoff" : "#iconEye");
            togglePassword.previousElementSibling.setAttribute("type", isEye ? "text" : "password");
        });
        ai.element.querySelectorAll("input, select").forEach((item) => {
            item.addEventListener("change", () => {
                fetchPost("/api/setting/setAI", {
                    openAI: {
                        apiUserAgent: (ai.element.querySelector("#apiUserAgent") as HTMLInputElement).value,
                        apiBaseURL: (ai.element.querySelector("#apiBaseURL") as HTMLInputElement).value,
                        apiVersion: (ai.element.querySelector("#apiVersion") as HTMLInputElement).value,
                        apiKey: (ai.element.querySelector("#apiKey") as HTMLInputElement).value,
                        apiModel: (ai.element.querySelector("#apiModel") as HTMLSelectElement).value,
                        apiMaxTokens: parseInt((ai.element.querySelector("#apiMaxTokens") as HTMLInputElement).value),
                        apiTemperature: parseFloat((ai.element.querySelector("#apiTemperature") as HTMLInputElement).value),
                        apiMaxContexts: parseInt((ai.element.querySelector("#apiMaxContexts") as HTMLInputElement).value),
                        apiProxy: (ai.element.querySelector("#apiProxy") as HTMLInputElement).value,
                        apiTimeout: parseInt((ai.element.querySelector("#apiTimeout") as HTMLInputElement).value),
                        apiProvider: (ai.element.querySelector("#apiProvider") as HTMLSelectElement).value,
                    }
                }, response => {
                    window.siyuan.config.ai = response.data;
                });
            });
        });
    },
};
