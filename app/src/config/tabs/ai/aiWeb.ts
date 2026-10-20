import type {SettingTabBuilder} from "../../setting/builder";

const webProviderDescription = (kind: "search" | "fetch", provider: string) => {
    if (kind === "search") {
        return provider === "deepseek" ? window.siyuan.languages.aiWebSearchProviderTip : window.siyuan.languages.aiWebSearchExaTip;
    }
    return provider === "deepseek" ? window.siyuan.languages.aiWebFetchProviderTip : window.siyuan.languages.aiWebFetchDirectTip;
};

const updateWebKeyVisibility = (root: HTMLElement) => {
    const search = root.querySelector<HTMLSelectElement>("[id=\"ai.web.searchProvider\"]");
    const fetch = root.querySelector<HTMLSelectElement>("[id=\"ai.web.fetchProvider\"]");
    const usesDeepSeek = search?.value === "deepseek" || fetch?.value === "deepseek";
    root.querySelector("[id=\"ai.web.apiKey\"]")?.closest(".config-item")?.classList.toggle("fn__none", !usesDeepSeek);
};

const mountWebProviderDescription = (root: HTMLElement, kind: "search" | "fetch") => {
    const select = root.querySelector<HTMLSelectElement>(`[id="ai.web.${kind}Provider"]`);
    const description = select?.closest(".config-item")?.querySelector<HTMLElement>(".b3-label__text");
    if (!select || !description) {
        return;
    }
    const update = () => {
        description.textContent = webProviderDescription(kind, select.value);
        updateWebKeyVisibility(root);
    };
    update();
    select.addEventListener("change", update);
};

export const registerAiWebGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("web", window.siyuan.languages.aiWebTools);
    group.select("ai.web.searchProvider", {
        title: window.siyuan.languages.aiWebSearchProvider,
        desc: webProviderDescription("search", window.siyuan.config.ai.web?.searchProvider),
        options: [{value: "exa", label: "Exa"}, {value: "deepseek", label: "DeepSeek"}],
        afterMount: root => mountWebProviderDescription(root, "search"),
    });
    group.select("ai.web.fetchProvider", {
        title: window.siyuan.languages.aiWebFetchProvider,
        desc: webProviderDescription("fetch", window.siyuan.config.ai.web?.fetchProvider),
        options: [{value: "direct", label: window.siyuan.languages.aiWebFetchDirect}, {value: "deepseek", label: "DeepSeek"}],
        afterMount: root => mountWebProviderDescription(root, "fetch"),
    });
    group.textBlock("ai.web.apiKey", {
        title: window.siyuan.languages.aiWebDeepSeekKey,
        desc: window.siyuan.languages.aiWebDeepSeekKeyTip,
        spellcheck: false,
        mode: "input-password",
        afterMount: updateWebKeyVisibility,
    });
    group.number("ai.web.timeout", {
        title: window.siyuan.languages.apiTimeout,
        desc: window.siyuan.languages.apiTimeoutTip,
        min: 1,
        max: 600,
        unit: "s",
    });
};
