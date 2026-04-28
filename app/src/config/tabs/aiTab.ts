import type {SettingTabBuilder} from "../setting/builder";

const registerAiServiceGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("service", window.siyuan.languages.configGroupServiceConnection);

    group.select("ai.openAI.apiProvider", {
        title: window.siyuan.languages.apiProvider,
        desc: window.siyuan.languages.apiProviderTip,
        options: [
            {value: "OpenAI"},
            {value: "Azure"},
        ],
        afterMount: bindApiProviderToggle,
    });
    group.textBlock("ai.openAI.apiBaseURL", {
        title: window.siyuan.languages.apiBaseURL,
        desc: window.siyuan.languages.apiBaseURLTip,
        mode: "input-text",
    });
    group.textBlock("ai.openAI.apiKey", {
        title: window.siyuan.languages.apiKey,
        desc: window.siyuan.languages.apiKeyTip,
        mode: "input-password",
    });
    group.textBlock("ai.openAI.apiVersion", {
        title: window.siyuan.languages.apiVersion,
        desc: window.siyuan.languages.apiVersionTip,
        mode: "input-text",
    });
    group.textBlock("ai.openAI.apiProxy", {
        title: window.siyuan.languages.apiProxy,
        desc: window.siyuan.languages.apiProxyTip,
        mode: "input-text",
    });
    group.textBlock("ai.openAI.apiUserAgent", {
        title: "User-Agent",
        desc: window.siyuan.languages.apiUserAgentTip,
        mode: "input-text",
    });
};

const bindApiProviderToggle = (root: HTMLElement) => {
    const providerSelect = root.querySelector<HTMLSelectElement>(`#${CSS.escape("ai.openAI.apiProvider")}`);
    if (!providerSelect) {
        return;
    }
    const toggleVersionWrap = () => {
        root.querySelector(`#${CSS.escape("ai.openAI.apiVersion")}`)?.closest(".config-item")?.classList.toggle("fn__none", providerSelect.value !== "Azure");
    };
    providerSelect.addEventListener("change", toggleVersionWrap);
    toggleVersionWrap();
};

const registerAiModelGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("model", window.siyuan.languages.configGroupModelParameters);

    group.textBlock("ai.openAI.apiModel", {
        title: window.siyuan.languages.apiModel,
        desc: window.siyuan.languages.apiModelTip,
        mode: "input-text",
    });
    group.number("ai.openAI.apiTimeout", {
        title: window.siyuan.languages.apiTimeout,
        desc: window.siyuan.languages.apiTimeoutTip,
        min: 5,
        max: 600,
        unit: "s",
    });
    group.number("ai.openAI.apiMaxTokens", {
        title: window.siyuan.languages.apiMaxTokens,
        desc: window.siyuan.languages.apiMaxTokensTip,
        min: 0,
    });
    group.number("ai.openAI.apiMaxContexts", {
        title: window.siyuan.languages.apiMaxContexts,
        desc: window.siyuan.languages.apiMaxContextsTip,
        min: 1,
        max: 64,
    });
    group.number("ai.openAI.apiTemperature", {
        title: window.siyuan.languages.apiTemperature,
        desc: window.siyuan.languages.apiTemperatureTip,
        min: 0,
        max: 2,
        step: "0.1",
    });
    group.number("ai.openAI.agentTimeout", {
        title: window.siyuan.languages.agentTimeout,
        desc: window.siyuan.languages.agentTimeoutTip,
        min: 0,
        unit: "s",
    });
    group.number("ai.openAI.agentConfirmTimeout", {
        title: window.siyuan.languages.agentConfirmTimeout,
        desc: window.siyuan.languages.agentConfirmTimeoutTip,
        min: 10,
        max: 600,
        unit: "s",
    });
    group.number("ai.openAI.agentMaxRetries", {
        title: window.siyuan.languages.agentMaxRetries,
        desc: window.siyuan.languages.agentMaxRetriesTip,
        min: 0,
        max: 10,
    });
};

export const registerAiTab = (tab: SettingTabBuilder) => {
    registerAiServiceGroup(tab);
    registerAiModelGroup(tab);
};
