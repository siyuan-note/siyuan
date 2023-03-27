import {fetchPost} from "../util/fetch";

export const ai = {
    element: undefined as Element,
    genHTML: () => {
        let responsiveHTML = ""
        /// #if MOBILE
        responsiveHTML = `<div class="b3-label">
    ${window.siyuan.languages.apiTimeout}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" type="number" step="1" min="5" max="600" id="apiTimeout" value="${window.siyuan.config.ai.openAI.apiTimeout}"/>     
    <div class="b3-label__text">${window.siyuan.languages.apiTimeoutTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.apiMaxTokens}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__flex-center fn__block" type="number" step="1" min="0" id="apiMaxTokens" max="4096" value="${window.siyuan.config.ai.openAI.apiMaxTokens}"/>
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
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.apiMaxTokens}
        <div class="b3-label__text">${window.siyuan.languages.apiMaxTokensTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" type="number" step="1" min="0" id="apiMaxTokens" max="4096" value="${window.siyuan.config.ai.openAI.apiMaxTokens}"/>
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
        ai.element.querySelectorAll("input").forEach((item) => {
            item.addEventListener("change", () => {
                fetchPost("/api/setting/setAI", {
                    openAI: {
                        apiBaseURL: (ai.element.querySelector("#apiBaseURL") as HTMLInputElement).value,
                        apiKey: (ai.element.querySelector("#apiKey") as HTMLInputElement).value,
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
