import {escapeHtmlTextAndAttr} from "../../../util/escape";
import {bindPasswordIconaToggle, genConfigItemMainHtml} from "../../render/fragments";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {fetchPost} from "../../../util/fetch";
import {aiConfigApi, AI_CONFIG_CHANGED_EVENT} from "./aiRuntime";
import {createProviderView, removeProviderView} from "./aiProviderUi";

type DecisionProvider = "typesafe" | "openai";
const PROVIDERS: DecisionProvider[] = ["typesafe", "openai"];
interface IDecisionField {
    key: keyof Config.IDecisionProfile;
    title: string;
    type: string;
}
// 各供应商分别声明字段和默认值，共用控件只负责渲染，不限定其他供应商的参数。
const PROVIDER_DETAILS: Record<DecisionProvider, {title: string; icon: string; endpointTip: string; defaults: Config.IDecisionProfile; fields: IDecisionField[]}> = {
    typesafe: {
        title: "TypeSafe System One",
        icon: "/stage/images/ai-providers/typesafe.svg",
        endpointTip: "decisionEndpointTip",
        defaults: {endpoint: "https://api.typesafe.ai/v1/systemone", apiKey: "", name: "jev-latest", timeout: 30},
        fields: [
            {key: "endpoint", title: "apiEndpoint", type: "url"},
            {key: "timeout", title: "apiTimeout", type: "number"},
            {key: "apiKey", title: "apiKey", type: "password"},
            {key: "name", title: "apiModel", type: "text"},
        ],
    },
    openai: {
        title: "OpenAI Decisions API (Beta)",
        icon: "/stage/images/ai-providers/openai.svg",
        endpointTip: "decisionOpenAIEndpointTip",
        defaults: {endpoint: "https://api.openai.com/v1/decisions", apiKey: "", name: "gpt-6-luna", timeout: 30},
        fields: [
            {key: "endpoint", title: "apiEndpoint", type: "url"},
            {key: "timeout", title: "apiTimeout", type: "number"},
            {key: "apiKey", title: "apiKey", type: "password"},
            {key: "name", title: "apiModel", type: "text"},
        ],
    },
};
const title = (provider: DecisionProvider) => PROVIDER_DETAILS[provider].title;
const escapeHTML = (value: string) => escapeHtmlTextAndAttr(value ?? "");

export const getDecisionProfileDraft = (decision: Config.IDecision, provider: DecisionProvider): Config.IDecisionProfile => {
    const profile = decision.profiles?.[provider];
    if (profile) {
        return {...profile};
    }
    const defaults = PROVIDER_DETAILS[provider].defaults;
    if (provider === "typesafe" && !decision.profiles) {
        return {endpoint: decision.endpoint || defaults.endpoint, apiKey: decision.apiKey || "",
            name: decision.name || defaults.name, timeout: decision.timeout || defaults.timeout};
    }
    return {...defaults};
};

// 只提交编辑的供应商配置，由设置补丁接口原子合并，保留其他供应商及其他窗口的修改。
export const getDecisionProfilePatch = (provider: DecisionProvider, profile: Config.IDecisionProfile, use: boolean) => ({
    profiles: {[provider]: {...profile}},
    ...(use ? {provider} : {}),
});

export const genDecisionCardsHtml = () => `<div class="b3-label config-item${window.siyuan.config.ai.decision.enabled ? "" : " fn__none"}" id="aiDecisionCardsBlock">
    ${genConfigItemMainHtml(window.siyuan.languages.apiProvider, window.siyuan.languages.decisionProvidersTip)}
    <div class="fn__hr"></div><div id="aiDecisionCards"></div>
</div>`;

const getDecisionEnabledInput = (root: HTMLElement) =>
    root.querySelector<HTMLInputElement>('[id="ai.decision.enabled"]');

const isDecisionEnabled = (root: HTMLElement) =>
    Boolean(window.siyuan.config.ai.decision.enabled) && getDecisionEnabledInput(root)?.checked !== false;

const renderDecisionCards = (root: HTMLElement) => {
    const container = root.querySelector<HTMLElement>("#aiDecisionCards");
    if (!container) { return; }
    const decision = window.siyuan.config.ai.decision;
    container.innerHTML = `<div class="b3-cards b3-cards--nowrap">${PROVIDERS.map(provider => {
        const active = (decision.provider || "typesafe") === provider;
        return `<div class="b3-card${active ? " b3-card--current" : ""}" role="button" tabindex="0" data-decision-provider="${provider}" aria-label="${escapeHTML(title(provider))}${active ? `: ${escapeHTML(window.siyuan.languages.decisionCurrentProvider)}` : ""}">
    <div class="b3-card__img"><img src="${PROVIDER_DETAILS[provider].icon}" class="config-ai-decision__icon" alt="${escapeHTML(title(provider))}"></div>
    <div class="fn__flex-1 fn__flex-column"><div class="b3-card__info b3-card__info--left fn__flex-1">
        <div class="fn__ellipsis config-name">${title(provider)}</div>
        <div class="b3-card__desc">${active ? window.siyuan.languages.decisionCurrentProvider : window.siyuan.languages.config}</div>
    </div></div>
</div>`;
    }).join("")}</div>`;
};

const openDecisionProfile = (root: HTMLElement, provider: DecisionProvider) => {
    if (!isDecisionEnabled(root)) { return; }
    const host = root.closest<HTMLElement>(".config__tab-container") || root;
    const existing = host.querySelector<HTMLElement>(`[data-decision-profile-view='${provider}'].config__view--show`);
    if (existing) {
        existing.dispatchEvent(new CustomEvent("siyuan-decision-profile-resume"));
        return;
    }
    const draft = getDecisionProfileDraft(window.siyuan.config.ai.decision, provider);
    const initial = JSON.stringify(draft);
    const view = createProviderView(root, window.siyuan.languages.apiProvider);
    view.setAttribute("data-decision-profile-view", provider);
    const fields = PROVIDER_DETAILS[provider].fields;
    const fieldInput = (field: IDecisionField) => {
        const className = field.key === "name" ? " fn__flex-1" : field.type === "password"
            ? " b3-form__icona-input" : " fn__flex-center fn__size200";
        return `<input id="aiDecisionDetail-${field.key}" class="b3-text-field${className}" data-decision-field="${field.key}" type="${field.type}" aria-label="${escapeHTML(window.siyuan.languages[field.title])}" spellcheck="false" autocomplete="off"${field.type === "number" ? ' min="1" max="600" step="1" required' : ""} value="${escapeHTML(String(draft[field.key]))}">`;
    };
    view.querySelector(".b3-dialog__body").innerHTML = `<div class="b3-dialog__content" style="padding: 0">
    <div class="config-group">
        <div class="config-title">${window.siyuan.languages.aiProviderSettings}</div>
        <div class="config-items">${fields.filter(field => field.key !== "name").map(field => {
        const input = fieldInput(field);
        return `<label class="fn__flex b3-label config-item">${genConfigItemMainHtml(window.siyuan.languages[field.title])}
            <span class="fn__space"></span>${field.type === "password" ? `<div class="b3-form__icona fn__size200">${input}<svg class="b3-form__icona-icon" data-action="togglePassword"><use xlink:href="#iconEye"></use></svg></div>` : input}</label>`;
    }).join("")}</div>
        <div class="b3-label b3-label--noborder"><div class="b3-label__text">${escapeHTML(title(provider))}<br>${window.siyuan.languages[PROVIDER_DETAILS[provider].endpointTip]}</div></div>
    </div>
    <div class="config-group">
        <div class="config-title">${window.siyuan.languages.aiModelSettings}</div>
        <div class="config-items">
            <div class="fn__flex b3-label config-item config-ai-provider__model">
                ${fieldInput(fields.find(field => field.key === "name"))}
                <span class="fn__space"></span>
                <button class="b3-button b3-button--outline" data-action="test">
                    <svg class="b3-button__icon"><use xlink:href="#iconPlugZap"></use></svg>
                    <span>${window.siyuan.languages.testConnection}</span>
                </button>
            </div>
        </div>
        <div class="b3-label b3-label--noborder">
            <div class="b3-label__text">${window.siyuan.languages.decisionTestDraftTip}</div>
            <div data-type="testResult" role="status" aria-live="polite"></div>
        </div>
    </div>
</div><div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-action="cancel">${window.siyuan.languages.cancel}</button><span class="fn__space"></span>
    <button class="b3-button b3-button--text" data-action="save">${window.siyuan.languages.save}</button><span class="fn__space"></span>
    <button class="b3-button b3-button--text" data-action="use">${window.siyuan.languages.decisionSaveAndUse}</button>
</div>`;
    bindPasswordIconaToggle(view, "aiDecisionDetail-apiKey");
    const result = view.querySelector<HTMLElement>("[data-type='testResult']");
    const testButton = view.querySelector<HTMLButtonElement>("[data-action='test']");
    const testLabel = testButton.querySelector("span");
    let revision = 0;
    let closed = false;
    let saving = false;
    let testing = false;
    const enabledInput = getDecisionEnabledInput(root);
    const canEdit = () => isDecisionEnabled(root) && !view.classList.contains("fn__none");
    const updateControls = () => {
        const disabled = !canEdit() || saving;
        view.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach(element => element.disabled = disabled);
        testButton.disabled = disabled || testing;
    };
    const stopWatching = () => {
        enabledInput?.removeEventListener("change", updateVisibility);
        root.removeEventListener(AI_CONFIG_CHANGED_EVENT, updateVisibility);
        window.removeEventListener(AI_CONFIG_CHANGED_EVENT, updateVisibility);
    };
    const updateVisibility = () => {
        if (!view.isConnected) { stopWatching(); return; }
        const enabled = isDecisionEnabled(root);
        const otherView = host.querySelector(".config__view--show:not(.fn__none)");
        // 隐藏详情但保留 DOM 和草稿，继续阻止设置刷新替换未保存的内容。
        view.classList.toggle("fn__none", !enabled || view.classList.contains("fn__none") && !!otherView && otherView !== view);
        if (!enabled) {
            revision++;
            result.textContent = "";
            if (view.contains(document.activeElement)) { enabledInput?.focus({preventScroll: true}); }
        }
        updateControls();
    };
    enabledInput?.addEventListener("change", updateVisibility);
    root.addEventListener(AI_CONFIG_CHANGED_EVENT, updateVisibility);
    window.addEventListener(AI_CONFIG_CHANGED_EVENT, updateVisibility);
    view.addEventListener("siyuan-decision-profile-resume", () => {
        if (closed || !isDecisionEnabled(root) || !view.classList.contains("fn__none")) { return; }
        removeProviderView(root);
        updateVisibility();
        view.querySelector<HTMLInputElement>("[data-decision-field='endpoint']")?.focus({preventScroll: true});
    });
    const leave = () => {
        closed = true;
        stopWatching();
        removeProviderView(root, view, () => {
            if (root.isConnected && isDecisionEnabled(root) && !host.querySelector(".config__view--show:not(.fn__none)")) {
                root.querySelector<HTMLElement>(`[data-decision-provider='${provider}']`)?.focus({preventScroll: true});
            }
            root.dispatchEvent(new CustomEvent("siyuan-decision-profile-closed", {bubbles: true}));
        });
    };
    const close = () => {
        if (saving || closed || !canEdit()) { return; }
        if (JSON.stringify(draft) !== initial) {
            confirmDialog(window.siyuan.languages.confirm, window.siyuan.languages.discardUnsavedChanges, leave);
        } else { leave(); }
    };
    const back = view.querySelector<HTMLElement>("[data-action='back']");
    back?.setAttribute("role", "button");
    back?.setAttribute("tabindex", "0");
    back?.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            close();
        }
    });
    // 入场动画尚未完成，禁止聚焦将设置面板滚动到视口外的详情位置。
    view.querySelector<HTMLInputElement>("[data-decision-field='endpoint']")?.focus({preventScroll: true});
    const validate = (required: boolean) => {
        for (const input of Array.from(view.querySelectorAll<HTMLInputElement>("[data-decision-field]"))) {
            input.required = required || input.type === "number";
            if (!input.reportValidity()) { return false; }
        }
        return true;
    };
    view.addEventListener("input", event => {
        if (!canEdit() || saving || closed) { return; }
        const input = event.target as HTMLInputElement;
        const field = input.dataset.decisionField as keyof Config.IDecisionProfile;
        if (!field) { return; }
        if (field === "timeout") { draft.timeout = input.valueAsNumber; } else { draft[field] = input.value; }
        revision++;
        result.textContent = "";
    });
    view.addEventListener("click", async event => {
        if (!canEdit()) { return; }
        const action = (event.target as Element).closest<HTMLElement>("[data-action]")?.dataset.action;
        if (action === "back" || action === "cancel") { close(); return; }
        if (saving || closed) { return; }
        if (action === "save" || action === "use") {
            if (!validate(action === "use")) { return; }
            saving = true;
            revision++;
            result.textContent = "";
            updateControls();
            let applied = false;
            try {
                await aiConfigApi.patch("decision", getDecisionProfilePatch(provider, draft, action === "use"), () => {
                    applied = true;
                    renderDecisionCards(root);
                    leave();
                });
            } finally {
                if (!applied) { result.textContent = window.siyuan.languages.decisionSaveFailed; }
                saving = false;
                updateControls();
            }
        } else if (action === "test" && !testing && validate(true)) {
            testing = true;
            testButton.disabled = true;
            testLabel.textContent = window.siyuan.languages.testConnectionTesting;
            result.textContent = "";
            const testedRevision = revision;
            const current = () => !closed && view.isConnected && canEdit() && testedRevision === revision;
            try {
                await fetchPost("/api/ai/testDecisionModel", {provider, profile: {...draft}}, response => {
                    if (!current()) { return; }
                    result.textContent = response.data?.matched ? window.siyuan.languages.testConnectionSuccess
                        : response.data?.msg ? window.siyuan.languages.testConnectionFailMsg.replace("${msg}", String(response.data.msg))
                            : window.siyuan.languages.testConnectionFail;
                }, undefined, () => {
                    if (current()) { result.textContent = window.siyuan.languages.testConnectionFail; }
                });
            } catch (_error) {
                if (current()) { result.textContent = window.siyuan.languages.testConnectionFail; }
            } finally {
                testing = false;
                updateControls();
                testLabel.textContent = window.siyuan.languages.testConnection;
            }
        }
    });
};

export const mountDecisionCards = (root: HTMLElement) => {
    const container = root.querySelector<HTMLElement>("#aiDecisionCards");
    const block = root.querySelector<HTMLElement>("#aiDecisionCardsBlock");
    if (!container || !block) { return; }
    const enabledInput = getDecisionEnabledInput(root);
    let changeRevision = 0;
    let pendingChange = 0;
    const updateVisibility = () => block.classList.toggle("fn__none", !(enabledInput?.checked ?? window.siyuan.config.ai.decision.enabled));
    enabledInput?.addEventListener("change", () => {
        const revision = ++changeRevision;
        pendingChange = revision;
        updateVisibility();
        const complete = () => {
            if (pendingChange !== revision || !container.isConnected) { return; }
            pendingChange = 0;
            enabledInput.checked = window.siyuan.config.ai.decision.enabled;
            updateVisibility();
            root.dispatchEvent(new CustomEvent(AI_CONFIG_CHANGED_EVENT));
        };
        // change 完整派发后委托保存已入队；旧响应不得覆盖用户最新一次切换。
        window.setTimeout(() => {
            if (pendingChange !== revision || !container.isConnected) { return; }
            void aiConfigApi.waitForSave().then(complete, complete);
        }, 0);
    });
    updateVisibility();
    renderDecisionCards(root);
    container.addEventListener("click", event => {
        const provider = (event.target as Element).closest<HTMLElement>("[data-decision-provider]")?.dataset.decisionProvider as DecisionProvider;
        if (PROVIDERS.includes(provider)) { openDecisionProfile(root, provider); }
    });
    container.addEventListener("keydown", event => {
        if (!isDecisionEnabled(root)) { return; }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            (event.target as HTMLElement).click();
        }
    });
    const update = () => {
        if (!container.isConnected) { window.removeEventListener(AI_CONFIG_CHANGED_EVENT, update); return; }
        if (enabledInput && !pendingChange) { enabledInput.checked = window.siyuan.config.ai.decision.enabled; }
        updateVisibility();
        renderDecisionCards(root);
    };
    window.addEventListener(AI_CONFIG_CHANGED_EVENT, update);
};
