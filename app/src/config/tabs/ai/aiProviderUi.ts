import {bindPasswordIconaToggle, genConfigItemMainHtml} from "../../render/fragments";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {showMessage} from "../../../dialog/message";
import {fetchPost} from "../../../util/fetch";
import {aiConfigApi} from "./aiRuntime";
import {Menu} from "../../../plugin/Menu";
import {upDownHint} from "../../../util/upDownHint";

type ModelPickerGroup = "editing" | "agent" | "imageGeneration";
type GroupedModelPickerElement = HTMLInputElement | HTMLButtonElement;

export interface IGroupedModelPickerOptions {
    menuId?: string;
    getSelectedModelId?: () => string;
    onSelect?: (modelId: string) => void;
}

export interface IGroupedModelPicker {
    update: () => void;
}

interface IProviderPreset {
    id: string;
    name: string;
    baseURL: string;
    category: "official" | "aggregator" | "local" | "custom";
    region?: "china" | "international";
    icon?: string;
}

const PROVIDER_PRESETS: IProviderPreset[] = [
    {id: "openai", name: "OpenAI", baseURL: "https://api.openai.com/v1", category: "official", icon: "/stage/images/ai-providers/openai.svg"},
    {id: "deepseek", name: "DeepSeek", baseURL: "https://api.deepseek.com", category: "official", icon: "/stage/images/ai-providers/deepseek.svg"},
    {id: "moonshot", name: "Moonshot AI", baseURL: "https://api.moonshot.cn/v1", category: "official", icon: "/stage/images/ai-providers/moonshot.svg"},
    {id: "minimax", name: "MiniMax", baseURL: "https://api.minimax.io/v1", category: "official", region: "international", icon: "/stage/images/ai-providers/minimax.svg"},
    {id: "minimax-cn", name: "MiniMax", baseURL: "https://api.minimaxi.com/v1", category: "official", region: "china", icon: "/stage/images/ai-providers/minimax.svg"},
    {id: "aliyun", name: "Alibaba Model Studio", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", category: "official", region: "china", icon: "/stage/images/ai-providers/aliyun.svg"},
    {id: "aliyun-intl", name: "Alibaba Model Studio", baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", category: "official", region: "international", icon: "/stage/images/ai-providers/aliyun.svg"},
    {id: "volcengine", name: "Volcengine Ark", baseURL: "https://ark.cn-beijing.volces.com/api/v3", category: "official", icon: "/stage/images/ai-providers/volcengine.svg"},
    {id: "zhipu", name: "Zhipu AI", baseURL: "https://open.bigmodel.cn/api/paas/v4", category: "official", icon: "/stage/images/ai-providers/zhipu.svg"},
    {id: "gemini", name: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", category: "official", icon: "/stage/images/ai-providers/gemini.svg"},
    {id: "mistral", name: "Mistral AI", baseURL: "https://api.mistral.ai/v1", category: "official", icon: "/stage/images/ai-providers/mistral.svg"},
    {id: "siliconflow", name: "SiliconFlow", baseURL: "https://api.siliconflow.cn/v1", category: "aggregator", icon: "/stage/images/ai-providers/siliconflow.svg"},
    {id: "openrouter", name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", category: "aggregator", icon: "/stage/images/ai-providers/openrouter.svg"},
    {id: "groq", name: "Groq", baseURL: "https://api.groq.com/openai/v1", category: "aggregator"},
    {id: "ollama", name: "Ollama", baseURL: "http://localhost:11434/v1", category: "local", icon: "/stage/images/ai-providers/ollama.svg"},
    {id: "lmstudio", name: "LM Studio", baseURL: "http://localhost:1234/v1", category: "local", icon: "/stage/images/ai-providers/lmstudio.svg"},
    {id: "custom", name: "", baseURL: "", category: "custom"},
];

const PROVIDER_CATEGORIES = ["official", "aggregator", "local", "custom"] as const;

const escapeHTML = (value: string) => Lute.EscapeHTMLStr(value ?? "");

const cloneProvider = (provider: Config.IProvider): Config.IProvider =>
    JSON.parse(JSON.stringify(provider)) as Config.IProvider;

const normalizeBaseURL = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();

const findPreset = (provider: Config.IProvider) =>
    PROVIDER_PRESETS.find((preset) => preset.baseURL && normalizeBaseURL(preset.baseURL) === normalizeBaseURL(provider.baseURL));

const requiresAPIKey = (provider: Config.IProvider) => {
    const preset = findPreset(provider);
    return preset?.category === "official" || preset?.category === "aggregator";
};

const getProviderName = (provider: Config.IProvider) =>
    provider.displayName || findPreset(provider)?.name || provider.baseURL;

const getProviderTitle = (provider: Config.IProvider) =>
    getProviderName(provider) || window.siyuan.languages.addAiProvider;

const getPresetTitle = (preset: IProviderPreset) => {
    const name = preset.name || window.siyuan.languages.custom;
    if (!preset.region) {
        return name;
    }
    const region = preset.region === "china"
        ? window.siyuan.languages.aiProviderRegionChina
        : window.siyuan.languages.aiProviderRegionInternational;
    return `${name} ${region}`;
};

const getCategoryTitle = (category: IProviderPreset["category"]) => {
    if (category === "official") {
        return window.siyuan.languages.aiProviderOfficial;
    }
    if (category === "aggregator") {
        return window.siyuan.languages.aiProviderAggregator;
    }
    if (category === "local") {
        return window.siyuan.languages.aiProviderLocal;
    }
    return window.siyuan.languages.custom;
};

const getProviderAvatarHTML = (provider: Config.IProvider, preset = findPreset(provider)) => {
    const title = getProviderTitle(provider);
    if (preset?.id === "custom") {
        return '<span><svg class="b3-card__icon"><use xlink:href="#iconBrain"></use></svg></span>';
    }
    if (preset?.icon) {
        return `<img src="${preset.icon}" alt="${escapeHTML(title)}">`;
    }
    return `<span>${escapeHTML(title.slice(0, 1).toUpperCase() || "AI")}</span>`;
};

const getProviderViewHost = (root: HTMLElement) =>
    root.closest<HTMLElement>(".config__tab-container") || root;

const getProviderViews = (root: HTMLElement) => {
    return Array.from(getProviderViewHost(root).children).filter((element): element is HTMLElement =>
        element instanceof HTMLElement && element.classList.contains("config-ai-provider__view"));
};

const removeProviderView = (root: HTMLElement, view?: HTMLElement) => {
    const views = view ? [view] : getProviderViews(root);
    views.forEach((item) => {
        item.classList.remove("config__view--show");
        item.addEventListener("transitionend", (event) => {
            if (event.propertyName === "opacity") {
                item.remove();
            }
        });
        window.setTimeout(() => item.remove(), 300);
    });
};

const createProviderView = (root: HTMLElement, backLabel: string, stacked = false) => {
    if (!stacked) {
        removeProviderView(root);
    }
    const host = getProviderViewHost(root);
    const layer = getProviderViews(root).length;
    const view = document.createElement("div");
    view.className = "config-ai-provider__view config__view";
    view.style.zIndex = String(3 + layer);
    view.innerHTML = `<div class="b3-dialog__header fn__flex">
    <div class="block__logo fn__pointer fn__flex-1" data-action="back">
        <svg class="block__logoicon"><use xlink:href="#iconLeft"></use></svg>
        <span class="ft__breakword">${escapeHTML(backLabel)}</span>
    </div>
</div>
<div class="b3-dialog__body"></div>`;
    host.append(view);
    view.getBoundingClientRect();
    view.classList.add("config__view--show");
    return view;
};

export const genProviderCardsHtml = (): string => `<div class="b3-label config-item" id="aiProviderCardsBlock">
    <div class="fn__flex config-wrap">
        ${genConfigItemMainHtml(window.siyuan.languages.openAICompatibleProvider, window.siyuan.languages.apiProviderTip)}
        <span class="fn__space"></span>
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="addProvider">
            <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
            <span>${window.siyuan.languages.addAiProvider}</span>
        </button>
    </div>
    <div class="fn__hr"></div>
    <div id="aiProviderCards"></div>
</div>`;

const renderProviderCards = (root: HTMLElement) => {
    const cards = root.querySelector<HTMLElement>("#aiProviderCards");
    if (!cards) {
        return;
    }
    const providerCards = window.siyuan.config.ai.providers.map((provider) => `<div class="b3-card" data-provider-id="${escapeHTML(provider.id)}" data-action="openProvider">
    <div class="b3-card__img">${getProviderAvatarHTML(provider)}</div>
    <div class="fn__flex-1 fn__flex-column">
        <div class="b3-card__info b3-card__info--left fn__flex-1">
            <div class="fn__ellipsis config-name">${escapeHTML(getProviderTitle(provider))}</div>
            <div class="b3-card__desc">
                ${escapeHTML(provider.baseURL)}<br>
                ${provider.models.length} ${window.siyuan.languages.apiModel}
            </div>
        </div>
    </div>
    <div class="b3-card__actions b3-card__actions--right">
        <input class="b3-switch" data-action="toggleProvider" type="checkbox"${provider.enabled ? " checked" : ""} aria-label="${window.siyuan.languages.enable}">
        <button class="block__icon block__icon--show block__icon--warning ariaLabel" data-action="deleteProvider" data-position="north" aria-label="${window.siyuan.languages.delete}">
            <svg><use xlink:href="#iconTrashcan"></use></svg>
        </button>
    </div>
</div>`).join("");
    cards.innerHTML = `<div class="b3-cards b3-cards--nowrap">${providerCards}</div>`;
};

const saveProviders = (root: HTMLElement, providers: Config.IProvider[], onApplied?: () => void) => {
    aiConfigApi.patch("providers", providers, () => {
        renderProviderCards(root);
        syncGroupedModelPickers(root);
        onApplied?.();
    });
};

const showDeleteProviderConfirm = (root: HTMLElement, provider: Config.IProvider) => {
    confirmDialog(
        window.siyuan.languages.deleteOpConfirm,
        window.siyuan.languages.confirmDeleteTip.replace("${x}", escapeHTML(getProviderTitle(provider))),
        () => saveProviders(root, window.siyuan.config.ai.providers.filter((item) => item.id !== provider.id)),
        undefined,
        true,
    );
};

const openProviderCatalog = (root: HTMLElement) => {
    const view = createProviderView(root, window.siyuan.languages.apiProvider);
    const body = view.querySelector<HTMLElement>(".b3-dialog__body");
    body.innerHTML = `<div class="b3-dialog__content" style="padding: 0">${PROVIDER_CATEGORIES.map((category) => {
        const cards = PROVIDER_PRESETS.filter((preset) => preset.category === category).map((preset) => {
            const provider: Config.IProvider = {
                id: "",
                enabled: true,
                displayName: preset.name,
                baseURL: preset.baseURL,
                apiKey: "",
                requestTimeout: 120,
                models: [],
            };
            const description = preset.baseURL
                ? escapeHTML(preset.baseURL)
                : window.siyuan.languages.apiBaseURLTip;
            return `<div class="b3-card" data-preset-id="${preset.id}">
    <div class="b3-card__img">${getProviderAvatarHTML(provider, preset)}</div>
    <div class="fn__flex-1 fn__flex-column">
        <div class="b3-card__info b3-card__info--left fn__flex-1">
            <div class="config-name">${escapeHTML(getPresetTitle(preset))}</div>
            <div class="b3-card__desc">${description}</div>
        </div>
    </div>
</div>`;
        }).join("");
        return `<div class="config-group">
    <div class="config-title">${getCategoryTitle(category)}</div>
    <div class="b3-cards">${cards}</div>
</div>`;
    }).join("")}</div>`;
    view.addEventListener("click", (event) => {
        const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        if (action?.dataset.action === "back") {
            removeProviderView(root, view);
            return;
        }
        const presetCard = (event.target as HTMLElement).closest<HTMLElement>("[data-preset-id]");
        if (!presetCard) {
            return;
        }
        const preset = PROVIDER_PRESETS.find((item) => item.id === presetCard.dataset.presetId);
        if (preset) {
            openProviderDetail(root, undefined, preset);
        }
    });
};

const renderDraftModels = (container: HTMLElement, models: Config.IModel[], availableModels: string[]) => {
    if (models.length === 0) {
        container.innerHTML = `<div class="b3-label config-item b3-card__desc">${window.siyuan.languages.noModelConfigured}</div>`;
        return;
    }
    const modelInputClass = availableModels.length > 0 ? "b3-select" : "b3-text-field";
    const modelInputAction = availableModels.length > 0 ? ' data-action="selectModel" data-menu="true" readonly' : "";
    container.innerHTML = models.map((model, index) => `<div class="fn__flex b3-label config-item config-wrap" data-model-index="${index}">
    <input class="b3-switch fn__flex-center" data-model-field="enabled" type="checkbox"${model.enabled ? " checked" : ""} aria-label="${window.siyuan.languages.enable}">
    <span class="fn__space"></span>
    <input class="${modelInputClass} fn__flex-1" data-model-field="name" type="text"${modelInputAction} spellcheck="false" placeholder="${window.siyuan.languages.selectModel}" value="${escapeHTML(model.name)}">
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-1" data-model-field="displayName" type="text" spellcheck="false" placeholder="${window.siyuan.languages.customDisplayName}" value="${escapeHTML(model.displayName || "")}">
    <span class="fn__space"></span>
    <input class="b3-text-field fn__size200 ariaLabel" data-model-field="contextLength" data-position="north" type="number" min="0" max="100000000" step="1" placeholder="${window.siyuan.languages.modelContextLength}" aria-label="${window.siyuan.languages.modelContextLengthTip}" value="${model.contextLength || ""}">
    <span class="fn__space"></span>
    <button class="b3-button b3-button--outline" data-action="testModel">
        <svg class="b3-button__icon"><use xlink:href="#iconPlugZap"></use></svg>
        <span>${window.siyuan.languages.testConnection}</span>
    </button>
    <span class="fn__space"></span>
    <button class="b3-button b3-button--remove b3-button--icon" data-action="deleteModel" aria-label="${window.siyuan.languages.delete}">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </button>
</div>`).join("");
};

const openAvailableModelMenu = (modelInput: HTMLInputElement, models: string[]) => {
    const menu = new Menu();
    menu.addItem({
        iconHTML: "",
        type: "empty",
        label: `<div class="fn__flex-column b3-menu__filter">
    <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.searchPlaceholder}">
    <div class="fn__hr"></div>
    <div class="b3-list fn__flex-1 b3-list--background">
        ${models.map((model) => `<div class="b3-list-item b3-list-item--narrow" data-model="${escapeHTML(model)}">
    <span class="b3-list-item__text">${escapeHTML(model)}</span>
    ${model === modelInput.value ? '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>' : ""}
</div>`).join("")}
        <div class="b3-list--empty fn__none" data-type="empty">${window.siyuan.languages.emptyContent}</div>
    </div>
</div>`,
        bind(element) {
            const listElement = element.querySelector<HTMLElement>(".b3-list");
            const searchInput = element.querySelector<HTMLInputElement>("input");
            const emptyElement = element.querySelector<HTMLElement>("[data-type='empty']");
            const selectModel = (item: HTMLElement) => {
                modelInput.value = item.dataset.model;
                modelInput.dispatchEvent(new InputEvent("input", {bubbles: true}));
                menu.close();
                modelInput.focus();
            };
            const filterModels = () => {
                const keyword = searchInput.value.toLowerCase().trim();
                let firstVisibleItem: HTMLElement;
                listElement.querySelectorAll<HTMLElement>(".b3-list-item").forEach((item) => {
                    item.classList.remove("b3-list-item--focus");
                    const hidden = !item.dataset.model.toLowerCase().includes(keyword);
                    item.classList.toggle("fn__none", hidden);
                    if (!hidden && !firstVisibleItem) {
                        firstVisibleItem = item;
                    }
                });
                firstVisibleItem?.classList.add("b3-list-item--focus");
                emptyElement.classList.toggle("fn__none", !!firstVisibleItem);
            };
            filterModels();
            searchInput.addEventListener("keydown", (event: KeyboardEvent) => {
                event.stopPropagation();
                if (event.isComposing) {
                    return;
                }
                upDownHint(listElement, event);
                if (event.key === "Enter") {
                    const item = listElement.querySelector<HTMLElement>(".b3-list-item--focus");
                    if (item) {
                        selectModel(item);
                    }
                    event.preventDefault();
                } else if (event.key === "Escape") {
                    menu.close();
                    modelInput.focus();
                    event.preventDefault();
                }
            });
            searchInput.addEventListener("input", (event: InputEvent) => {
                if (!event.isComposing) {
                    filterModels();
                }
            });
            searchInput.addEventListener("compositionend", filterModels);
            listElement.addEventListener("click", (event) => {
                const item = (event.target as HTMLElement).closest<HTMLElement>(".b3-list-item");
                if (item) {
                    selectModel(item);
                }
            });
        },
    });
    const rect = modelInput.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width, target: modelInput});
    menu.element.querySelector(".b3-menu__items").setAttribute("style", "overflow: initial");
    menu.element.querySelector<HTMLInputElement>("input").focus();
};

const showTestResult = (data: Record<string, unknown>) => {
    if (data.matched) {
        showMessage(window.siyuan.languages.testConnectionSuccess, undefined, "info");
        return;
    }
    const available = data.available;
    if (Array.isArray(available) && available.length > 0) {
        showMessage(window.siyuan.languages.testConnectionFailModelNotFound, undefined, "error");
        return;
    }
    showMessage(
        data.msg
            ? window.siyuan.languages.testConnectionFailMsg.replace("${msg}", escapeHTML(String(data.msg)))
            : window.siyuan.languages.testConnectionFail,
        undefined,
        "error",
    );
};

const openProviderDetail = (root: HTMLElement, providerId?: string, preset?: IProviderPreset) => {
    const existing = providerId
        ? window.siyuan.config.ai.providers.find((provider) => provider.id === providerId)
        : undefined;
    if (providerId && !existing) {
        return;
    }
    const draft: Config.IProvider = existing ? cloneProvider(existing) : {
        id: "",
        enabled: true,
        displayName: preset?.name || "",
        baseURL: preset?.baseURL || "",
        apiKey: "",
        requestTimeout: 120,
        models: [],
    };
    const initialJSON = JSON.stringify(draft);
    const openedFromCatalog = !existing && !!preset;
    const view = createProviderView(
        root,
        openedFromCatalog ? window.siyuan.languages.addAiProvider : window.siyuan.languages.apiProvider,
        openedFromCatalog,
    );
    const body = view.querySelector<HTMLElement>(".b3-dialog__body");
    body.innerHTML = `<div class="b3-dialog__content" style="padding: 0">
    <div class="config-group">
        <div class="config-title">${window.siyuan.languages.aiProviderSettings}</div>
        <div class="config-items">
            <label class="fn__flex b3-label config-item config-wrap">
                ${genConfigItemMainHtml(window.siyuan.languages.customDisplayName)}
                <span class="fn__space"></span>
                <input class="b3-text-field fn__flex-center fn__size200" data-provider-field="displayName" type="text" spellcheck="false" value="${escapeHTML(draft.displayName || "")}">
            </label>
            <label class="fn__flex b3-label config-item config-wrap">
                ${genConfigItemMainHtml(window.siyuan.languages.apiBaseURL)}
                <span class="fn__space"></span>
                <input class="b3-text-field fn__flex-center fn__size200" data-provider-field="baseURL" type="text" spellcheck="false" value="${escapeHTML(draft.baseURL)}">
            </label>
            <label class="fn__flex b3-label config-item config-wrap">
                ${genConfigItemMainHtml(window.siyuan.languages.apiTimeout)}
                <span class="fn__space"></span>
                <input class="b3-text-field fn__flex-center fn__size200" data-provider-field="requestTimeout" type="number" min="1" max="600" value="${draft.requestTimeout}">
            </label>
            <label class="fn__flex b3-label config-item config-wrap">
                ${genConfigItemMainHtml(window.siyuan.languages.apiKey)}
                <span class="fn__space"></span>
                <div class="b3-form__icona fn__size200">
                    <input id="aiProviderDetailApiKey" class="b3-text-field b3-form__icona-input" data-provider-field="apiKey" type="password" value="${escapeHTML(draft.apiKey)}">
                    <svg class="b3-form__icona-icon" data-action="togglePassword"><use xlink:href="#iconEye"></use></svg>
                </div>
            </label>
        </div>
    </div>
    <div class="config-group">
        <div class="config-title config-title--action">
            <span>${window.siyuan.languages.aiModelSettings}</span>
            <div class="fn__flex-1"></div>
            <button class="b3-button b3-button--outline" data-action="addModel">
                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                <span>${window.siyuan.languages.addAiModel}</span>
            </button>
            <span class="fn__space"></span>
            <button class="b3-button b3-button--outline" data-action="fetchModels">
                <svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>
                <span>${window.siyuan.languages.fetchAvailableModels}</span>
            </button>
        </div>
        <div class="config-items">
            <div data-type="providerModels"></div>
        </div>
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-action="cancel">${window.siyuan.languages.cancel}</button>
    <span class="fn__space"></span>
    <button class="b3-button b3-button--text" data-action="confirm">${window.siyuan.languages.confirm}</button>
</div>`;
    bindPasswordIconaToggle(view, "aiProviderDetailApiKey");
    const modelsContainer = view.querySelector<HTMLElement>("[data-type='providerModels']");
    const addModelButton = view.querySelector<HTMLButtonElement>("[data-action='addModel']");
    const fetchModelsButton = view.querySelector<HTMLButtonElement>("[data-action='fetchModels']");
    const confirmButton = view.querySelector<HTMLButtonElement>("[data-action='confirm']");
    let availableModels: string[] = [];
    let availableModelContextLengths: Record<string, number> = {};
    let hasFetchedModels = false;
    let fetchingModels = false;
    const validateAPIKey = () => {
        if (!requiresAPIKey(draft) || draft.apiKey.trim() !== "") {
            return true;
        }
        view.querySelector<HTMLInputElement>("[data-provider-field='apiKey']")?.focus();
        showMessage(window.siyuan.languages.apiKeyRequired, undefined, "error");
        return false;
    };
    const getAvailableModelContextLength = (name: string) =>
        availableModelContextLengths[name] || availableModelContextLengths[name.toLowerCase()] || 0;
    const updateModelActionButtons = () => {
        const disabled = fetchingModels || !draft.baseURL.trim();
        addModelButton.disabled = disabled;
        fetchModelsButton.disabled = disabled;
    };
    updateModelActionButtons();
    renderDraftModels(modelsContainer, draft.models, availableModels);

    const addDraftModel = () => {
        draft.models.push({id: "", enabled: true, name: "", displayName: ""});
        renderDraftModels(modelsContainer, draft.models, availableModels);
        const modelInput = modelsContainer.querySelector<HTMLInputElement>(
            "[data-model-index]:last-child [data-model-field='name']",
        );
        if (!modelInput) {
            return;
        }
        if (availableModels.length > 0) {
            openAvailableModelMenu(modelInput, availableModels);
        } else {
            modelInput.focus();
        }
    };

    const fetchModels = (onFinished?: () => void) => {
        if (fetchingModels) {
            return;
        }
        if (!draft.baseURL.trim()) {
            view.querySelector<HTMLInputElement>("[data-provider-field='baseURL']")?.focus();
            showMessage(window.siyuan.languages.apiBaseURLTip, undefined, "error");
            return;
        }
        if (!validateAPIKey()) {
            return;
        }
        hasFetchedModels = true;
        fetchingModels = true;
        const icon = fetchModelsButton.querySelector<SVGSVGElement>(".b3-button__icon");
        updateModelActionButtons();
        confirmButton.disabled = true;
        icon?.classList.add("fn__rotate");
        fetchPost("/api/ai/listModels", {providerConfig: draft}, (response) => {
            if (!view.isConnected) {
                return;
            }
            const data = response.data || {};
            const responseModels: unknown[] = Array.isArray(data.models) ? data.models : [];
            const models = responseModels
                .filter((name): name is string => typeof name === "string" && name.trim() !== "")
                .map((name) => name.trim());
            availableModelContextLengths = {};
            const responseContextLengths = data.contextLengths;
            if (responseContextLengths && typeof responseContextLengths === "object") {
                Object.entries(responseContextLengths as Record<string, unknown>).forEach(([name, value]) => {
                    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
                        availableModelContextLengths[name] = value;
                        availableModelContextLengths[name.toLowerCase()] = value;
                    }
                });
            }
            if (models.length === 0) {
                showMessage(
                    data.msg
                        ? `${window.siyuan.languages.fetchAvailableModelsFail} ${escapeHTML(String(data.msg))}`
                        : window.siyuan.languages.fetchAvailableModelsFail,
                    undefined,
                    "error",
                );
                return;
            }
            availableModels = [...new Set(models)].sort((first, second) => first.localeCompare(second));
            draft.models.forEach((model) => {
                const contextLength = getAvailableModelContextLength(model.name);
                if (contextLength > 0) {
                    model.contextLength = contextLength;
                }
            });
            if (draft.models.length === 0) {
                const model: Config.IModel = {
                    id: "",
                    enabled: true,
                    name: availableModels[0],
                    displayName: "",
                };
                const contextLength = getAvailableModelContextLength(model.name);
                if (contextLength > 0) {
                    model.contextLength = contextLength;
                }
                draft.models.push(model);
            }
            renderDraftModels(modelsContainer, draft.models, availableModels);
            showMessage(
                window.siyuan.languages.fetchAvailableModelsSuccess
                    .replace("${x}", String(availableModels.length)),
                undefined,
                "info",
            );
        }).finally(() => {
            fetchingModels = false;
            if (!view.isConnected) {
                return;
            }
            updateModelActionButtons();
            confirmButton.disabled = false;
            icon?.classList.remove("fn__rotate");
            onFinished?.();
        });
    };

    const leaveDetail = () => {
        removeProviderView(root, view);
    };

    const closeDetail = () => {
        if (JSON.stringify(draft) !== initialJSON) {
            confirmDialog(
                window.siyuan.languages.confirm,
                window.siyuan.languages.discardUnsavedChanges,
                leaveDetail,
            );
            return;
        }
        leaveDetail();
    };

    view.addEventListener("input", (event) => {
        const target = event.target as HTMLInputElement;
        const providerField = target.dataset.providerField as "displayName" | "baseURL" | "apiKey" | "requestTimeout";
        if (providerField) {
            if (providerField === "requestTimeout") {
                draft.requestTimeout = Number.isFinite(target.valueAsNumber) ? target.valueAsNumber : 120;
            } else {
                draft[providerField] = target.value;
            }
            if (providerField === "baseURL") {
                updateModelActionButtons();
            }
            return;
        }
        const modelField = target.dataset.modelField as "name" | "displayName" | "contextLength";
        const modelIndex = Number(target.closest<HTMLElement>("[data-model-index]")?.dataset.modelIndex);
        if (modelField && draft.models[modelIndex]) {
            if (modelField === "contextLength") {
                draft.models[modelIndex].contextLength =
                    Number.isSafeInteger(target.valueAsNumber) && target.valueAsNumber > 0
                        ? target.valueAsNumber
                        : 0;
                return;
            }
            draft.models[modelIndex][modelField] = target.value;
            if (modelField === "name") {
                const contextLength = getAvailableModelContextLength(target.value);
                if (contextLength > 0) {
                    draft.models[modelIndex].contextLength = contextLength;
                } else {
                    delete draft.models[modelIndex].contextLength;
                }
            }
        }
    });

    view.addEventListener("change", (event) => {
        const target = event.target as HTMLInputElement;
        if (target.dataset.modelField !== "enabled") {
            return;
        }
        const modelIndex = Number(target.closest<HTMLElement>("[data-model-index]")?.dataset.modelIndex);
        if (draft.models[modelIndex]) {
            draft.models[modelIndex].enabled = target.checked;
        }
    });

    view.addEventListener("keydown", (event) => {
        const target = event.target as HTMLInputElement;
        if (target.dataset.action !== "selectModel" ||
            !["Enter", " ", "ArrowDown"].includes(event.key)) {
            return;
        }
        event.preventDefault();
        openAvailableModelMenu(target, availableModels);
    });

    view.addEventListener("click", (event) => {
        const actionElement = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        const action = actionElement?.dataset.action;
        if (!action || action === "togglePassword") {
            return;
        }
        if (action === "back" || action === "cancel") {
            closeDetail();
            return;
        }
        if (action === "addModel") {
            if (!validateAPIKey()) {
                return;
            }
            if (!hasFetchedModels) {
                const modelCount = draft.models.length;
                fetchModels(() => {
                    if (draft.models.length === modelCount) {
                        addDraftModel();
                    }
                });
                return;
            }
            addDraftModel();
            return;
        }
        const modelIndex = Number(actionElement.closest<HTMLElement>("[data-model-index]")?.dataset.modelIndex);
        if (action === "selectModel" && availableModels.length > 0) {
            openAvailableModelMenu(actionElement as HTMLInputElement, availableModels);
            return;
        }
        if (action === "deleteModel" && draft.models[modelIndex]) {
            draft.models.splice(modelIndex, 1);
            renderDraftModels(modelsContainer, draft.models, availableModels);
            return;
        }
        if (action === "fetchModels") {
            fetchModels();
            return;
        }
        if (action === "testModel" && draft.models[modelIndex]) {
            const model = draft.models[modelIndex];
            if (!draft.baseURL.trim()) {
                view.querySelector<HTMLInputElement>("[data-provider-field='baseURL']")?.focus();
                showMessage(window.siyuan.languages.apiBaseURLTip, undefined, "error");
                return;
            }
            if (!validateAPIKey()) {
                return;
            }
            if (!model.name.trim()) {
                showMessage(window.siyuan.languages.testConnectionFailModelRequired);
                return;
            }
            const button = actionElement as HTMLButtonElement;
            const label = button.querySelector("span");
            button.disabled = true;
            label.textContent = window.siyuan.languages.testConnectionTesting;
            fetchPost("/api/ai/testModel", {providerConfig: draft, model: model.name.trim()}, (response) => {
                if (view.isConnected) {
                    showTestResult(response.data || {});
                }
            }).finally(() => {
                if (view.isConnected) {
                    button.disabled = false;
                    label.textContent = window.siyuan.languages.testConnection;
                }
            });
            return;
        }
        if (action === "confirm") {
            const emptyModel = draft.models.find((model) => !model.name.trim());
            if (!draft.baseURL.trim()) {
                view.querySelector<HTMLInputElement>("[data-provider-field='baseURL']")?.focus();
                return;
            }
            if (emptyModel) {
                showMessage(window.siyuan.languages.testConnectionFailModelRequired);
                return;
            }
            draft.baseURL = draft.baseURL.trim();
            draft.displayName = draft.displayName?.trim();
            draft.apiKey = draft.apiKey.trim();
            draft.models.forEach((model) => {
                model.name = model.name.trim();
                model.displayName = model.displayName?.trim();
            });
            const providers = existing
                ? window.siyuan.config.ai.providers.map((provider) => provider.id === existing.id ? draft : provider)
                : [...window.siyuan.config.ai.providers, draft];
            saveProviders(root, providers, () => removeProviderView(root));
        }
    });
};

export const mountProviderCards = (root: HTMLElement) => {
    const block = root.querySelector<HTMLElement>("#aiProviderCardsBlock");
    if (!block) {
        return;
    }
    renderProviderCards(root);
    block.addEventListener("click", (event) => {
        const actionElement = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        const action = actionElement?.dataset.action;
        if (action === "addProvider") {
            openProviderCatalog(root);
            return;
        }
        const providerId = actionElement?.closest<HTMLElement>("[data-provider-id]")?.dataset.providerId;
        const provider = window.siyuan.config.ai.providers.find((item) => item.id === providerId);
        if (!provider) {
            return;
        }
        if (action === "deleteProvider") {
            event.stopPropagation();
            showDeleteProviderConfirm(root, provider);
        } else if (action === "openProvider") {
            openProviderDetail(root, provider.id);
        }
    });
    block.addEventListener("change", (event) => {
        const target = event.target as HTMLInputElement;
        if (target.dataset.action !== "toggleProvider") {
            return;
        }
        event.stopPropagation();
        const providerId = target.closest<HTMLElement>("[data-provider-id]")?.dataset.providerId;
        const providers = window.siyuan.config.ai.providers.map((provider) =>
            provider.id === providerId ? {...provider, enabled: target.checked} : provider);
        saveProviders(root, providers);
    });
};

const getEnabledModelGroups = () => window.siyuan.config.ai.providers
    .filter((provider) => provider.enabled)
    .map((provider) => ({
        provider,
        models: provider.models.filter((model) => model.enabled),
    }))
    .filter((group) => group.models.length > 0);

const getFirstEnabledModelId = () => getEnabledModelGroups()[0]?.models[0]?.id || "";

const getSelectedModelId = (group: ModelPickerGroup) => {
    const savedModelId = window.siyuan.config.ai[group].modelId;
    const valid = getEnabledModelGroups().some((item) => item.models.some((model) => model.id === savedModelId));
    if (valid || group === "imageGeneration") {
        return valid ? savedModelId : "";
    }
    return getFirstEnabledModelId();
};

const getModelPickerLabel = (modelId: string) => {
    for (const {models} of getEnabledModelGroups()) {
        const model = models.find((item) => item.id === modelId);
        if (model) {
            return model.displayName || model.name;
        }
    }
    return window.siyuan.languages.noModelConfigured;
};

const setGroupedModelPickerLabel = (element: GroupedModelPickerElement, label: string) => {
    if (element instanceof HTMLInputElement) {
        element.value = label;
    } else {
        const labelElement = element.querySelector('[data-type="groupedModelPickerLabel"]');
        if (labelElement) {
            labelElement.textContent = label;
        } else {
            element.textContent = label;
        }
    }
};

const updateGroupedModelPicker = (element: GroupedModelPickerElement, selectedModelId: string) => {
    element.dataset.modelId = selectedModelId;
    setGroupedModelPickerLabel(element, getModelPickerLabel(selectedModelId));
    element.disabled = getEnabledModelGroups().length === 0;
};

const getGroupedModelMenuId = (group: ModelPickerGroup, options?: IGroupedModelPickerOptions) =>
    options?.menuId || `ai-model-picker-${group}`;

const isGroupedModelMenuOpen = (menuId: string) => {
    const menuElement = window.siyuan.menus.menu.element;
    return !menuElement.classList.contains("fn__none") &&
        menuElement.getAttribute("data-name") === menuId;
};

const openGroupedModelMenu = (
    root: HTMLElement,
    element: GroupedModelPickerElement,
    group: ModelPickerGroup,
    options: IGroupedModelPickerOptions,
    update: () => void,
) => {
    if (element.disabled) {
        return;
    }
    const modelGroups = getEnabledModelGroups();
    const selectedModelId = options.getSelectedModelId ? options.getSelectedModelId() : getSelectedModelId(group);
    const menu = new Menu(getGroupedModelMenuId(group, options));
    if (menu.isOpen) {
        return;
    }
    const selectModel = (modelId: string, label: string) => {
        if (modelId === selectedModelId) {
            return;
        }
        if (options.onSelect) {
            options.onSelect(modelId);
            update();
            return;
        }
        element.dataset.modelId = modelId;
        setGroupedModelPickerLabel(element, label);
        aiConfigApi.patch(`${group}.modelId`, modelId, () => syncGroupedModelPickers(root));
    };
    const optional = group === "imageGeneration";
    if (optional) {
        menu.addItem({
            iconHTML: "",
            label: window.siyuan.languages.noModelConfigured,
            current: selectedModelId === "",
            click: () => selectModel("", window.siyuan.languages.noModelConfigured),
        });
        menu.addSeparator();
    }
    modelGroups.forEach(({provider, models}, index) => {
        if (index > 0) {
            menu.addSeparator();
        }
        menu.addItem({
            iconHTML: "",
            type: "readonly",
            label: escapeHTML(getProviderTitle(provider)),
        });
        models.forEach((model) => {
            const label = model.displayName || model.name;
            menu.addItem({
                iconHTML: "",
                label: escapeHTML(label),
                current: model.id === selectedModelId,
                click: () => selectModel(model.id, label),
            });
        });
    });
    const rect = element.getBoundingClientRect();
    menu.element.style.minWidth = `${rect.width}px`;
    menu.open({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width, target: element});
};

const syncGroupedModelPickers = (root: HTMLElement) => {
    (["editing", "agent", "imageGeneration"] as const).forEach((group) => {
        const input = root.querySelector<HTMLInputElement>(`[data-type="groupedModelPicker"][data-group="${group}"]`);
        if (!input) {
            return;
        }
        updateGroupedModelPicker(input, getSelectedModelId(group));
    });
};

export const genGroupedModelPickerHtml = (group: ModelPickerGroup): string => {
    let desc: string;
    if (group === "editing") {
        desc = window.siyuan.languages.aiEditingModelPickerTip;
    } else if (group === "agent") {
        desc = window.siyuan.languages.aiAgentModelPickerTip;
    } else {
        desc = window.siyuan.languages.aiImageGenerationTip;
    }
    const selectedModelId = getSelectedModelId(group);
    const disabled = getEnabledModelGroups().length === 0 ? " disabled" : "";
    const modelLabel = getModelPickerLabel(selectedModelId);
    return `<div class="fn__flex b3-label config-item config-wrap" id="aiModelPickerBlock-${group}" data-type="aiModelPicker" data-name="${group}">
    ${genConfigItemMainHtml(window.siyuan.languages.defaultModel, desc)}
    <span class="fn__space"></span>
    <input class="b3-select fn__flex-center fn__size200" data-type="groupedModelPicker" data-group="${group}" data-model-id="${escapeHTML(selectedModelId)}" data-menu="true" type="text" value="${escapeHTML(modelLabel)}" readonly${disabled}>
</div>`;
};

export const mountGroupedModelPicker = (
    root: HTMLElement,
    group: ModelPickerGroup,
    options: IGroupedModelPickerOptions = {},
): IGroupedModelPicker | undefined => {
    const element = root.querySelector<GroupedModelPickerElement>(`[data-type="groupedModelPicker"][data-group="${group}"]`);
    if (!element) {
        return;
    }
    const menuId = getGroupedModelMenuId(group, options);
    const update = () => updateGroupedModelPicker(
        element,
        options.getSelectedModelId ? options.getSelectedModelId() : getSelectedModelId(group),
    );
    const openMenu = () => openGroupedModelMenu(root, element, group, options, update);
    update();
    element.addEventListener("click", openMenu);
    element.addEventListener("keydown", (event: KeyboardEvent) => {
        if (!["Enter", " ", "ArrowDown"].includes(event.key)) {
            return;
        }
        if (isGroupedModelMenuOpen(menuId)) {
            return;
        }
        event.preventDefault();
        openMenu();
    });
    return {update};
};
