import {fetchPost} from "../util/fetch";

export const ai = {
    element: undefined as Element,
    genHTML: () => {
        let responsiveHTML = "";
        /// #if MOBILE
        responsiveHTML = `<div class="b3-label">
    ${window.siyuan.languages.apiTimeout}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" type="number" step="1" min="5" max="600" id="apiTimeout" value="${window.siyuan.config.ai.openAI.apiTimeout}"/>     
    <div class="b3-label__text">${window.siyuan.languages.apiTimeoutTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiModel}
    <div class="b3-label__text">
        ${window.siyuan.languages.apiModelTip}
    </div>
    <div class="b3-label__text fn__flex config__item" style="padding: 4px 0 4px 4px;">
        <select id="apiModel" class="b3-select">
            <option value="gpt-4" ${window.siyuan.config.ai.openAI.apiModel === "gpt-4" ? "selected" : ""}>gpt-4</option>
            <option value="gpt-4-32k" ${window.siyuan.config.ai.openAI.apiModel === "gpt-4-32k" ? "selected" : ""}>gpt-4-32k</option>
            <option value="gpt-3.5-turbo" ${window.siyuan.config.ai.openAI.apiModel === "gpt-3.5-turbo" ? "selected" : ""}>gpt-3.5-turbo</option>
            <option value="gpt-3.5-turbo-16k" ${window.siyuan.config.ai.openAI.apiModel === "gpt-3.5-turbo-16k" ? "selected" : ""}>gpt-3.5-turbo-16k</option>
        </select>
    </div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiMaxTokens}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" type="number" step="1" min="0" id="apiMaxTokens" value="${window.siyuan.config.ai.openAI.apiMaxTokens}"/>
    <div class="b3-label__text">${window.siyuan.languages.apiMaxTokensTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiKey}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__block" id="apiKey" value="${window.siyuan.config.ai.openAI.apiKey}"/>
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
</div>`;
        /// #else
        responsiveHTML = `<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiTimeout}
        <div class="b3-label__text">${window.siyuan.languages.apiTimeoutTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" type="number" step="1" min="5" max="600" id="apiTimeout" value="${window.siyuan.config.ai.openAI.apiTimeout}"/>
</label>
<label class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiModel}
        <div class="b3-label__text">${window.siyuan.languages.apiModelTip}</div>
    </div>
    <span class="fn__space"></span>
    <select id="apiModel" class="b3-select fn__flex-center fn__size200">
        <option value="gpt-4" ${window.siyuan.config.ai.openAI.apiModel === "gpt-4" ? "selected" : ""}>gpt-4</option>
        <option value="gpt-4-32k" ${window.siyuan.config.ai.openAI.apiModel === "gpt-4-32k" ? "selected" : ""}>gpt-4-32k</option>
        <option value="gpt-3.5-turbo" ${window.siyuan.config.ai.openAI.apiModel === "gpt-3.5-turbo" ? "selected" : ""}>gpt-3.5-turbo</option>
        <option value="gpt-3.5-turbo-16k" ${window.siyuan.config.ai.openAI.apiModel === "gpt-3.5-turbo-16k" ? "selected" : ""}>gpt-3.5-turbo-16k</option>
    </select>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiMaxTokens}
        <div class="b3-label__text">${window.siyuan.languages.apiMaxTokensTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" type="number" step="1" min="0" id="apiMaxTokens" value="${window.siyuan.config.ai.openAI.apiMaxTokens}"/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiKey}
        <div class="b3-label__text">${window.siyuan.languages.apiKeyTip}</div>
        <div class="fn__hr"></div>
        <input class="b3-text-field fn__block" id="apiKey" value="${window.siyuan.config.ai.openAI.apiKey}"/>
    </div>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiProxy}
        <div class="b3-label__text">${window.siyuan.languages.apiProxyTip}</div>
        <span class="fn__hr"></span>
        <input class="b3-text-field fn__block" id="apiProxy" value="${window.siyuan.config.ai.openAI.apiProxy}"/>
    </div>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiBaseURL}
        <div class="b3-label__text">${window.siyuan.languages.apiBaseURLTip}</div>
        <span class="fn__hr"></span>
        <input class="b3-text-field fn__block" id="apiBaseURL" value="${window.siyuan.config.ai.openAI.apiBaseURL}"/>
    </div>
</label>`;
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
        ai.element.querySelectorAll("input,select").forEach((item) => {
            item.addEventListener("change", () => {
                fetchPost("/api/setting/setAI", {
                    openAI: {
                        apiBaseURL: (ai.element.querySelector("#apiBaseURL") as HTMLInputElement).value,
                        apiKey: (ai.element.querySelector("#apiKey") as HTMLInputElement).value,
                        apiModel: (ai.element.querySelector("#apiModel") as HTMLSelectElement).value,
                        apiMaxTokens: parseInt((ai.element.querySelector("#apiMaxTokens") as HTMLInputElement).value),
                        apiProxy: (ai.element.querySelector("#apiProxy") as HTMLInputElement).value,
                        apiTimeout: parseInt((ai.element.querySelector("#apiTimeout") as HTMLInputElement).value),
                    }
                }, response => {
                    window.siyuan.config.ai = response.data;
                });
            });
        });
    },
};
