import {bindPasswordIconaToggle} from "../render/fragments";
import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {fetchPost} from "../../util/fetch";
import {aiConfigApi} from "./aiRuntime";
import {Menu} from "../../plugin/Menu";
import {upDownHint} from "../../util/upDownHint";

type ModelPickerGroup = "editing" | "agent" | "vision" | "imageGeneration";

interface IProviderPreset {
    id: string;
    name: string;
    baseURL: string;
    category: "official" | "aggregator" | "local" | "custom";
    region?: "china" | "international";
    icon?: string;
    iconColor?: string;
}

const PROVIDER_PRESETS: IProviderPreset[] = [
    {id: "openai", name: "OpenAI", baseURL: "https://api.openai.com/v1", category: "official", icon: "/stage/images/ai-providers/openai.svg"},
    {id: "deepseek", name: "DeepSeek", baseURL: "https://api.deepseek.com", category: "official", icon: "/stage/images/ai-providers/deepseek.svg", iconColor: "#5786FE"},
    {id: "moonshot", name: "Moonshot AI", baseURL: "https://api.moonshot.cn/v1", category: "official", icon: "/stage/images/ai-providers/moonshot.svg"},
    {id: "minimax", name: "MiniMax", baseURL: "https://api.minimax.io/v1", category: "official", region: "international", icon: "/stage/images/ai-providers/minimax.svg", iconColor: "#E73562"},
    {id: "minimax-cn", name: "MiniMax", baseURL: "https://api.minimaxi.com/v1", category: "official", region: "china", icon: "/stage/images/ai-providers/minimax.svg", iconColor: "#E73562"},
    {id: "aliyun", name: "Alibaba Model Studio", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", category: "official", region: "china", icon: "/stage/images/ai-providers/aliyun.svg", iconColor: "#FF6A00"},
    {id: "aliyun-intl", name: "Alibaba Model Studio", baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", category: "official", region: "international", icon: "/stage/images/ai-providers/aliyun.svg", iconColor: "#FF6A00"},
    {id: "volcengine", name: "Volcengine Ark", baseURL: "https://ark.cn-beijing.volces.com/api/v3", category: "official", icon: "/stage/images/ai-providers/volcengine.svg"},
    {id: "zhipu", name: "Zhipu AI", baseURL: "https://open.bigmodel.cn/api/paas/v4", category: "official", icon: "/stage/images/ai-providers/zhipu.svg"},
    {id: "gemini", name: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", category: "official", icon: "/stage/images/ai-providers/gemini.svg", iconColor: "#8E75B2"},
    {id: "mistral", name: "Mistral AI", baseURL: "https://api.mistral.ai/v1", category: "official", icon: "/stage/images/ai-providers/mistral.svg", iconColor: "#FA520F"},
    {id: "siliconflow", name: "SiliconFlow", baseURL: "https://api.siliconflow.cn/v1", category: "aggregator", icon: "/stage/images/ai-providers/siliconflow.svg"},
    {id: "openrouter", name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", category: "aggregator", icon: "/stage/images/ai-providers/openrouter.svg", iconColor: "#94A3B8"},
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

const providerTitle = (provider: Config.IProvider) =>
    provider.displayName || findPreset(provider)?.name || provider.baseURL || window.siyuan.languages.addAiProvider;

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
    const title = providerTitle(provider);
    if (preset?.icon) {
        if (preset.iconColor) {
            return `<span class="config-ai-provider__logo config-ai-provider__logo--brand" style="--config-ai-provider-logo-color: ${preset.iconColor}; --config-ai-provider-logo-image: url('${preset.icon}')" role="img" aria-label="${escapeHTML(title)}"></span>`;
        }
        return `<img class="config-ai-provider__logo config-ai-provider__logo--${preset.id}" src="${preset.icon}" alt="${escapeHTML(title)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false">
<span class="config-ai-provider__initial" hidden>${escapeHTML(title.slice(0, 1).toUpperCase())}</span>`;
    }
    return `<span class="config-ai-provider__initial">${escapeHTML(title.slice(0, 1).toUpperCase() || "AI")}</span>`;
};

const getProviderViewHost = (root: HTMLElement) =>
    root.closest<HTMLElement>(".config__tab-container") || root;

const getProviderViews = (root: HTMLElement) => {
    return Array.from(getProviderViewHost(root).children).filter((element): element is HTMLElement =>
        element instanceof HTMLElement && element.classList.contains("config-ai-provider__view"));
};

const removeProviderView = (root: HTMLElement, view?: HTMLElement) => {
    if (view) {
        view.remove();
    } else {
        getProviderViews(root).forEach((item) => item.remove());
    }
};

const createProviderView = (root: HTMLElement, title: string, stacked = false) => {
    if (!stacked) {
        removeProviderView(root);
    }
    const host = getProviderViewHost(root);
    const layer = getProviderViews(root).length;
    const view = document.createElement("div");
    view.className = "config-ai-provider__view";
    view.style.zIndex = String(3 + layer);
    view.innerHTML = `<div class="config-ai-provider__view-head">
    <button class="block__icon block__icon--show" data-action="back" aria-label="${window.siyuan.languages.back}">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </button>
    <div class="config-ai-provider__view-title">${escapeHTML(title)}</div>
</div>
<div class="config-ai-provider__view-body"></div>`;
    host.append(view);
    return view;
};

export const genProviderCardsHtml = (): string => `<div class="b3-label config-item config-ai-provider" id="aiProviderCardsBlock">
    <div class="b3-label__text">${window.siyuan.languages.apiProviderTip}</div>
    <div class="fn__hr"></div>
    <div id="aiProviderCards"></div>
</div>`;

const renderProviderCards = (root: HTMLElement) => {
    const cards = root.querySelector<HTMLElement>("#aiProviderCards");
    if (!cards) {
        return;
    }
    const providerCards = window.siyuan.config.ai.providers.map((provider) => `<div class="b3-card config-ai-provider__card" data-provider-id="${escapeHTML(provider.id)}" data-action="openProvider">
    <div class="config-ai-provider__avatar">${getProviderAvatarHTML(provider)}</div>
    <div class="b3-card__info config-ai-provider__info">
        <div class="fn__ellipsis config-ai-provider__name">${escapeHTML(providerTitle(provider))}</div>
        <div class="b3-card__desc">${escapeHTML(provider.baseURL)}</div>
        <div class="config-ai-provider__meta"><span>${provider.models.length}</span><span>${window.siyuan.languages.apiModel}</span></div>
    </div>
    <div class="b3-card__actions b3-card__actions--right config-ai-provider__actions">
        <input class="b3-switch" data-action="toggleProvider" type="checkbox"${provider.enabled ? " checked" : ""} aria-label="${window.siyuan.languages.enable}">
        <button class="block__icon block__icon--show block__icon--warning" data-action="deleteProvider" aria-label="${window.siyuan.languages.delete}">
            <svg><use xlink:href="#iconTrashcan"></use></svg>
        </button>
    </div>
</div>`).join("");
    const addCard = `<div class="b3-card config-ai-provider__card config-ai-provider__card--add" data-action="addProvider">
    <svg><use xlink:href="#iconAdd"></use></svg>
    <span>${window.siyuan.languages.addAiProvider}</span>
</div>`;
    cards.innerHTML = `<div class="b3-cards config-ai-provider__cards">${providerCards}${addCard}</div>`;
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
        window.siyuan.languages.confirmDeleteTip.replace("${x}", escapeHTML(providerTitle(provider))),
        () => saveProviders(root, window.siyuan.config.ai.providers.filter((item) => item.id !== provider.id)),
        undefined,
        true,
    );
};

const openProviderCatalog = (root: HTMLElement) => {
    const view = createProviderView(root, window.siyuan.languages.addAiProvider);
    const body = view.querySelector<HTMLElement>(".config-ai-provider__view-body");
    body.innerHTML = `<div class="config-ai-provider__catalog">${PROVIDER_CATEGORIES.map((category) => {
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
            return `<div class="b3-card config-ai-provider__catalog-card" data-preset-id="${preset.id}">
    <div class="config-ai-provider__avatar">${getProviderAvatarHTML(provider, preset)}</div>
    <div class="b3-card__info config-ai-provider__info">
        <div class="config-ai-provider__name">${escapeHTML(getPresetTitle(preset))}</div>
        <div class="b3-card__desc">${description}</div>
    </div>
</div>`;
        }).join("");
        return `<section class="config-ai-provider__catalog-section">
    <div class="config-ai-provider__catalog-title">${getCategoryTitle(category)}</div>
    <div class="b3-cards config-ai-provider__catalog-grid">${cards}</div>
</section>`;
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
        container.innerHTML = `<div class="b3-label__text config-ai-provider__empty">${window.siyuan.languages.noModelConfigured}</div>`;
        return;
    }
    const modelInputClass = availableModels.length > 0 ? "b3-select" : "b3-text-field";
    const modelInputAction = availableModels.length > 0 ? ' data-action="selectModel" readonly' : "";
    container.innerHTML = models.map((model, index) => `<div class="config-ai-provider__model" data-model-index="${index}">
    <input class="b3-switch" data-model-field="enabled" type="checkbox"${model.enabled ? " checked" : ""} aria-label="${window.siyuan.languages.enable}">
    <input class="${modelInputClass}" data-model-field="name" type="text"${modelInputAction} spellcheck="false" placeholder="${window.siyuan.languages.selectModel}" value="${escapeHTML(model.name)}">
    <input class="b3-text-field" data-model-field="displayName" type="text" spellcheck="false" placeholder="${window.siyuan.languages.customDisplayName}" value="${escapeHTML(model.displayName || "")}">
    <button class="b3-button b3-button--outline" data-action="testModel">
        <svg class="b3-button__icon"><use xlink:href="#iconPlugZap"></use></svg>
        <span>${window.siyuan.languages.testConnection}</span>
    </button>
    <button class="block__icon block__icon--show block__icon--warning" data-action="deleteModel" aria-label="${window.siyuan.languages.delete}">
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
    <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.search}">
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
    menu.open({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width});
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
    const view = createProviderView(root, providerTitle(draft), !existing && !!preset);
    const body = view.querySelector<HTMLElement>(".config-ai-provider__view-body");
    body.innerHTML = `<div class="config-ai-provider__detail">
    <div class="config-ai-provider__section">
        <div class="config-ai-provider__section-title">${window.siyuan.languages.aiProviderSettings}</div>
        <div class="config-ai-provider__fields">
            <label class="config-ai-provider__field">
                <span>${window.siyuan.languages.customDisplayName}</span>
                <input class="b3-text-field" data-provider-field="displayName" type="text" spellcheck="false" value="${escapeHTML(draft.displayName || "")}">
            </label>
            <label class="config-ai-provider__field">
                <span>${window.siyuan.languages.apiBaseURL}</span>
                <input class="b3-text-field" data-provider-field="baseURL" type="text" spellcheck="false" value="${escapeHTML(draft.baseURL)}">
            </label>
            <label class="config-ai-provider__field">
                <span>${window.siyuan.languages.apiTimeout}</span>
                <input class="b3-text-field" data-provider-field="requestTimeout" type="number" min="1" max="600" value="${draft.requestTimeout}">
            </label>
            <div class="config-ai-provider__field">
                <span>${window.siyuan.languages.apiKey}</span>
                <div class="b3-form__icona config-ai-provider__api-key-input">
                    <input id="aiProviderDetailApiKey" class="b3-text-field b3-form__icona-input fn__block" data-provider-field="apiKey" type="password" value="${escapeHTML(draft.apiKey)}">
                    <svg class="b3-form__icona-icon" data-action="togglePassword"><use xlink:href="#iconEye"></use></svg>
                </div>
            </div>
        </div>
    </div>
    <div class="config-ai-provider__section">
        <div class="config-ai-provider__section-head">
            <div class="config-ai-provider__section-title">${window.siyuan.languages.aiModelSettings}</div>
            <div class="fn__flex">
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
        </div>
        <div class="config-ai-provider__models"></div>
    </div>
    <div class="config-ai-provider__footer">
        <button class="b3-button b3-button--cancel" data-action="cancel">${window.siyuan.languages.cancel}</button>
        <span class="fn__space"></span>
        <button class="b3-button b3-button--text" data-action="confirm">${window.siyuan.languages.confirm}</button>
    </div>
</div>`;
    bindPasswordIconaToggle(view, "aiProviderDetailApiKey");
    const modelsContainer = view.querySelector<HTMLElement>(".config-ai-provider__models");
    const addModelButton = view.querySelector<HTMLButtonElement>("[data-action='addModel']");
    const fetchModelsButton = view.querySelector<HTMLButtonElement>("[data-action='fetchModels']");
    const confirmButton = view.querySelector<HTMLButtonElement>("[data-action='confirm']");
    let availableModels: string[] = [];
    let hasFetchedModels = false;
    let fetchingModels = false;
    const updateModelActionButtons = () => {
        const disabled = fetchingModels || !draft.apiKey.trim();
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
        if (!draft.apiKey.trim()) {
            view.querySelector<HTMLInputElement>("[data-provider-field='apiKey']")?.focus();
            showMessage(window.siyuan.languages.apiKeyTip, undefined, "error");
            return;
        }
        if (!draft.baseURL.trim()) {
            view.querySelector<HTMLInputElement>("[data-provider-field='baseURL']")?.focus();
            showMessage(window.siyuan.languages.apiBaseURLTip, undefined, "error");
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
            if (draft.models.length === 0) {
                draft.models.push({
                    id: "",
                    enabled: true,
                    name: availableModels[0],
                    displayName: "",
                });
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
            if (providerField === "apiKey") {
                updateModelActionButtons();
            }
            view.querySelector<HTMLElement>(".config-ai-provider__view-title").textContent = providerTitle(draft);
            return;
        }
        const modelField = target.dataset.modelField as "name" | "displayName";
        const modelIndex = Number(target.closest<HTMLElement>("[data-model-index]")?.dataset.modelIndex);
        if (modelField && draft.models[modelIndex]) {
            draft.models[modelIndex][modelField] = target.value;
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
            if (!draft.apiKey.trim()) {
                view.querySelector<HTMLInputElement>("[data-provider-field='apiKey']")?.focus();
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
    if (valid || group === "vision" || group === "imageGeneration") {
        return valid ? savedModelId : "";
    }
    return getFirstEnabledModelId();
};

const buildGroupedModelOptions = (group: ModelPickerGroup, selectedModelId: string) => {
    const optional = group === "vision" || group === "imageGeneration";
    const emptyOption = optional || getEnabledModelGroups().length === 0
        ? `<option value="">${window.siyuan.languages.noModelConfigured}</option>`
        : "";
    return emptyOption + getEnabledModelGroups().map(({provider, models}) =>
        `<optgroup label="${escapeHTML(providerTitle(provider))}">${models.map((model) =>
            `<option value="${escapeHTML(model.id)}"${model.id === selectedModelId ? " selected" : ""}>${escapeHTML(model.displayName || model.name)}</option>`
        ).join("")}</optgroup>`
    ).join("");
};

const syncGroupedModelPickers = (root: HTMLElement) => {
    (["editing", "agent", "vision", "imageGeneration"] as const).forEach((group) => {
        const select = root.querySelector<HTMLSelectElement>(`[data-type="groupedModelPicker"][data-group="${group}"]`);
        if (!select) {
            return;
        }
        const selectedModelId = getSelectedModelId(group);
        select.innerHTML = buildGroupedModelOptions(group, selectedModelId);
        select.value = selectedModelId;
        select.disabled = getEnabledModelGroups().length === 0;
    });
};

export const genGroupedModelPickerHtml = (group: ModelPickerGroup): string => {
    let desc: string;
    if (group === "editing") {
        desc = window.siyuan.languages.aiEditingModelPickerTip;
    } else if (group === "agent") {
        desc = window.siyuan.languages.aiAgentModelPickerTip;
    } else if (group === "vision") {
        desc = window.siyuan.languages.aiImageUnderstandingTip;
    } else {
        desc = window.siyuan.languages.aiImageGenerationTip;
    }
    const selectedModelId = getSelectedModelId(group);
    const disabled = getEnabledModelGroups().length === 0 ? " disabled" : "";
    return `<div class="b3-label config-item" id="aiModelPickerBlock-${group}" data-type="aiModelPicker" data-name="${group}">
    <div class="fn__block">
        <div class="config-name">${window.siyuan.languages.defaultModel}</div>
        <div class="b3-label__text">${desc}</div>
        <div class="fn__hr--small"></div>
        <select class="b3-select fn__block" data-type="groupedModelPicker" data-group="${group}"${disabled}>
            ${buildGroupedModelOptions(group, selectedModelId)}
        </select>
    </div>
</div>`;
};

export const mountGroupedModelPicker = (root: HTMLElement, group: ModelPickerGroup) => {
    const select = root.querySelector<HTMLSelectElement>(`[data-type="groupedModelPicker"][data-group="${group}"]`);
    if (!select) {
        return;
    }
    select.addEventListener("change", () => {
        aiConfigApi.patch(`${group}.modelId`, select.value, () => syncGroupedModelPickers(root));
    });
};
