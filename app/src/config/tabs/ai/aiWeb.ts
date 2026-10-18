import type {SettingTabBuilder} from "../../setting/builder";

export const registerAiWebGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("web", window.siyuan.languages.aiWebTools);
    group.select("ai.web.searchProvider", {
        title: window.siyuan.languages.aiWebSearchProvider,
        desc: window.siyuan.languages.aiWebSearchProviderTip,
        options: [{value: "exa", label: "Exa"}, {value: "deepseek", label: "DeepSeek"}],
    });
    group.select("ai.web.fetchProvider", {
        title: window.siyuan.languages.aiWebFetchProvider,
        desc: window.siyuan.languages.aiWebFetchProviderTip,
        options: [{value: "direct", label: window.siyuan.languages.aiWebFetchDirect}, {value: "deepseek", label: "DeepSeek"}],
    });
    group.textBlock("ai.web.apiKey", {
        title: window.siyuan.languages.aiWebDeepSeekKey,
        desc: window.siyuan.languages.aiWebDeepSeekKeyTip,
        spellcheck: false,
        mode: "input-password",
    });
    group.number("ai.web.timeout", {
        title: window.siyuan.languages.apiTimeout,
        desc: window.siyuan.languages.apiTimeoutTip,
        min: 1,
        max: 600,
        unit: "s",
    });
};
