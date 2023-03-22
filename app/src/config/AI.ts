import {fetchPost} from "../util/fetch";

export const AI = {
    element: undefined as Element,
    genHTML: () => {
        return `<div class="fn__flex-column" style="height: 100%">
<div class="layout-tab-bar fn__flex">
    <div data-type="openai" class="item item--full item--focus"><span class="fn__flex-1"></span><span class="item__text">OpenAI</span><span class="fn__flex-1"></span></div>
</div>
<div class="fn__flex-1">
    <div data-type="openai">
        <label class="fn__flex b3-label">
            <div class="fn__flex-1">
                ${window.siyuan.languages.apiKey}
                <div class="b3-label__text">${window.siyuan.languages.apiKeyTip}</div>
            </div>
            <span class="fn__space"></span>
            <input class="b3-text-field fn__flex-center" id="apiKey" value="${window.siyuan.config.ai.openAI.apiKey}"/>
        </label>
        <label class="fn__flex b3-label">
            <div class="fn__flex-1">
                ${window.siyuan.languages.apiTimeout}
                <div class="b3-label__text">${window.siyuan.languages.apiTimeoutTip}</div>
            </div>
            <span class="fn__space"></span>
            <input class="b3-text-field fn__flex-center" type="number" step="1" min="5" max="600" id="apiTimeout" value="${window.siyuan.config.ai.openAI.apiTimeout}"/>
        </label>
        <label class="fn__flex b3-label">
            <div class="fn__flex-1">
                ${window.siyuan.languages.apiMaxTokens}
                <div class="b3-label__text">${window.siyuan.languages.apiMaxTokensTip}</div>
            </div>
            <span class="fn__space"></span>
            <input class="b3-text-field fn__flex-center" type="number" step="1" min="0" id="apiMaxTokens" max="4096" value="${window.siyuan.config.ai.openAI.apiMaxTokens}"/>
        </label>
        <label class="fn__flex b3-label">
            <div class="fn__flex-1">
                ${window.siyuan.languages.apiProxy}
                <div class="b3-label__text">${window.siyuan.languages.apiProxyTip}</div>
            </div>
            <span class="fn__space"></span>
            <input class="b3-text-field fn__flex-center" id="apiProxy" value="${window.siyuan.config.ai.openAI.apiProxy}"/>
        </label>
        <label class="fn__flex b3-label">
            <div class="fn__flex-1">
                ${window.siyuan.languages.apiBaseURL}
                <div class="b3-label__text">${window.siyuan.languages.apiBaseURLTip}</div>
            </div>
            <span class="fn__space"></span>
            <input class="b3-text-field fn__flex-center" id="apiBaseURL" value="${window.siyuan.config.ai.openAI.apiBaseURL}"/>
        </label>
    </div>
</div>
</div>`;
    },
    bindEvent: () => {
        AI.element.querySelectorAll("input").forEach((item) => {
            item.addEventListener("change", () => {
                fetchPost("/api/setting/setAI", {
                    openAI: {
                        apiBaseURL: (AI.element.querySelector("#apiBaseURL") as HTMLInputElement).value,
                        apiKey: (AI.element.querySelector("#apiKey") as HTMLInputElement).value,
                        apiMaxTokens: parseInt((AI.element.querySelector("#apiMaxTokens") as HTMLInputElement).value),
                        apiProxy: (AI.element.querySelector("#apiProxy") as HTMLInputElement).value,
                        apiTimeout: parseInt((AI.element.querySelector("#apiTimeout") as HTMLInputElement).value),
                    }
                }, response => {
                    window.siyuan.config.ai = response.data;
                });
            });
        });
    },
};
