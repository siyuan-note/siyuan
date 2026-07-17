import {bindPasswordIconaToggle} from "../render/fragments";
import {Dialog} from "../../dialog";
import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {Constants} from "../../constants";
import {isMobile} from "../../util/functions";
import {fetchPost} from "../../util/fetch";
import {aiConfigApi} from "./aiRuntime";
import {openByMobile} from "../../editor/openLink";
import {Menu} from "../../plugin/Menu";
import {upDownHint} from "../../util/upDownHint";
/// #if !BROWSER
import {shell} from "electron";
/// #endif

type ModelPickerGroup = "editing" | "agent" | "vision" | "imageGeneration";

export const getProvidersBlockKeywords = (): string[] => [
    window.siyuan.languages.apiProvider,
    window.siyuan.languages.apiProviderTip,
    window.siyuan.languages.addAiProvider,
    window.siyuan.languages.addAiModel,
    window.siyuan.languages.aiProviderSettings,
    window.siyuan.languages.aiModelSettings,
    window.siyuan.languages.apiBaseURL,
    window.siyuan.languages.apiBaseURLTip,
    window.siyuan.languages.apiKey,
    window.siyuan.languages.apiKeyTip,
    window.siyuan.languages.apiTimeout,
    window.siyuan.languages.apiTimeoutTip,
    window.siyuan.languages.customDisplayName,
    window.siyuan.languages.aiProviderDisplayNameTip,
    window.siyuan.languages.aiModelDisplayNameTip,
    window.siyuan.languages.apiModel,
    window.siyuan.languages.apiModelTip,
    window.siyuan.languages.noProviderConfigured,
    window.siyuan.languages.noModelConfigured,
    window.siyuan.languages.testConnection,
    window.siyuan.languages.testConnectionFailModelRequired,
    window.siyuan.languages.testConnectionFailModelNotFound,
    window.siyuan.languages.fetchAvailableModels,
    window.siyuan.languages.fetchAvailableModelsFail,
    window.siyuan.languages.selectModel,
];

export const getEmbeddingStatsKeywords = (): string[] => [
    window.siyuan.languages.embeddingIndexProgress,
    window.siyuan.languages.rebuildEmbeddingIndex,
    window.siyuan.languages.rebuildEmbeddingIndexTip,
];

// genEmbeddingStatsHtml 生成嵌入索引进度区块。容器留空，由 mountEmbeddingStatsBlock 轮询填充。
export const genEmbeddingStatsHtml = (): string => `<div class="b3-label config-item" id="aiEmbeddingStatsBlock">
    <div class="fn__block">
        <div class="config-name">${window.siyuan.languages.embeddingIndexProgress}</div>
        <div class="b3-label__text fn__none" id="aiEmbeddingStatsDisabled">${window.siyuan.languages.embeddingNotEnabledTip}</div>
        <div id="aiEmbeddingStatsContent" class="fn__none">
            <div class="fn__hr--small"></div>
            <div style="margin: 8px 0;height: 8px;border-radius: var(--b3-border-radius);overflow: hidden;background-color: var(--b3-theme-surface-lighter);" id="aiEmbeddingProgressBar">
                <div id="aiEmbeddingProgressFill" style="width: 0%;transition: var(--b3-transition);background-color: var(--b3-theme-primary);height: 8px;"></div>
            </div>
            <div id="aiEmbeddingStatsNum" style="font-size: 13px;color: var(--b3-theme-on-surface);margin-top: 8px;"></div>
            <a id="aiEmbeddingRetryFailed" class="fn__none b3-link" style="display: block;margin-top: 4px;font-size: 12px;">${window.siyuan.languages.retryFailedEmbedding}</a>
        </div>
    </div>
</div>`;

// mountEmbeddingStatsBlock 轮询 /api/ai/embeddingStat 刷新进度条与统计数字。设置页关闭时清理定时器。
export const mountEmbeddingStatsBlock = (root: HTMLElement) => {
    const block = root.querySelector("#aiEmbeddingStatsBlock");
    if (!block) {
        return;
    }

    const render = () => {
        fetchPost("/api/ai/embeddingStat", {}, (response) => {
            const stat = response.data as {
                total: number, indexed: number, pending: number, failed: number, ignoredByLen: number, ignoredByConfig: number, enabled: boolean,
            };
            if (!stat) {
                return;
            }
            const contentEl = block.querySelector("#aiEmbeddingStatsContent");
            const disabledEl = block.querySelector("#aiEmbeddingStatsDisabled");
            if (!contentEl || !disabledEl) {
                return;
            }
            if (!stat.enabled) {
                // 未启用：隐藏进度区，显示提示
                contentEl.classList.add("fn__none");
                disabledEl.classList.remove("fn__none");
                return;
            }
            contentEl.classList.remove("fn__none");
            disabledEl.classList.add("fn__none");

            const total = stat.total || 0;
            const indexed = stat.indexed || 0;
            const pending = stat.pending || 0;
            // 进度条分母排除被忽略的块（长度忽略 + 配置忽略），它们永远不会被索引，否则进度条到不了 100%
            const ignored = (stat.ignoredByLen || 0) + (stat.ignoredByConfig || 0);
            const effectiveTotal = Math.max(0, total - ignored);
            const percent = effectiveTotal > 0 ? Math.min(100, indexed / effectiveTotal * 100) : 0;
            const fillEl = block.querySelector("#aiEmbeddingProgressFill") as HTMLElement;
            if (!fillEl) {
                return;
            }
            fillEl.style.width = `${percent}%`;

            const done = indexed >= effectiveTotal && pending === 0;
            if (done) {
                // 完成：静态条
                fillEl.style.backgroundImage = "";
                fillEl.style.animation = "";
            } else {
                // 索引中：条状动画
                fillEl.style.backgroundImage = "linear-gradient(-45deg, rgba(255,255,255,0.2) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.2) 75%, transparent 75%, transparent)";
                fillEl.style.animation = "stripMove 450ms linear infinite";
                fillEl.style.backgroundSize = "50px 50px";
            }

            const numEl = block.querySelector("#aiEmbeddingStatsNum");
            if (!numEl) {
                return;
            }
            // 每个统计项独立一行，避免单行过长被截断
            numEl.innerHTML = `<div>${window.siyuan.languages.embeddingIndexed}<b>${indexed}</b> / ${total}</div>
                <div>${window.siyuan.languages.embeddingPending}<b>${pending}</b></div>
                <div>${window.siyuan.languages.embeddingFailed}<b>${stat.failed || 0}</b></div>
                <div>${window.siyuan.languages.embeddingIgnoredByLen}<b>${stat.ignoredByLen || 0}</b></div>
                <div>${window.siyuan.languages.embeddingIgnoredByConfig}<b>${stat.ignoredByConfig || 0}</b></div>`;

            // 有失败块时显示“重试失败”链接
            const retryEl = block.querySelector("#aiEmbeddingRetryFailed") as HTMLElement;
            if (retryEl) {
                if (stat.failed > 0) {
                    retryEl.classList.remove("fn__none");
                } else {
                    retryEl.classList.add("fn__none");
                }
            }
        });
    };

    // “重试失败”点击：删除失败块行让其回到主循环重嵌，无需确认框（操作轻，只删空向量行）
    block.querySelector("#aiEmbeddingRetryFailed")?.addEventListener("click", () => {
        fetchPost("/api/ai/retryFailedEmbedding", {}, () => {
            showMessage(window.siyuan.languages.retryFailedEmbeddingStarted);
        });
    });

    render();
    const timer = window.setInterval(render, 3000);
    // block 从 DOM 移除（设置页关闭/切换）时清理定时器，避免内存泄漏
    const cleanup = () => {
        if (!document.contains(block)) {
            window.clearInterval(timer);
            return;
        }
        window.requestAnimationFrame(cleanup);
    };
    window.requestAnimationFrame(cleanup);
};

// mountEmbeddingTestBtn 在嵌入「模型」输入框下方注入测试连接按钮，点击后用极简文本请求嵌入端点验证连通性。
// 嵌入配置即时保存，点测试时内核已持最新配置，故无需前端传参。
export const mountEmbeddingTestBtn = (root: HTMLElement) => {
    const inputEl = root.querySelector<HTMLInputElement>('[id="ai.embedding.name"]');
    if (!inputEl) {
        return;
    }
    // input 自身带 fn__block class，closest 会命中自身，故从 .config-item 往下精确定位外层容器
    const wrapper = inputEl.closest(".config-item")?.querySelector(".fn__block");
    if (!wrapper) {
        return;
    }
    const btnContainer = document.createElement("div");
    btnContainer.style.textAlign = "right";
    btnContainer.style.marginTop = "8px";
    btnContainer.innerHTML = `<button class="b3-button b3-button--outline" id="aiEmbeddingTestBtn"><svg class="b3-button__icon"><use xlink:href="#iconPlugZap"></use></svg><span>${window.siyuan.languages.testConnection}</span></button>`;
    wrapper.appendChild(btnContainer);

    const testBtn = btnContainer.querySelector<HTMLButtonElement>("#aiEmbeddingTestBtn");
    const iconUse = testBtn.querySelector("use");
    const svgEl = testBtn.querySelector("svg");
    const labelSpan = testBtn.querySelector("span");
    testBtn.addEventListener("click", () => {
        testBtn.disabled = true;
        iconUse.setAttribute("xlink:href", "#iconRefresh");
        svgEl.style.animation = "agent-mirror-spin 0.8s linear infinite";
        labelSpan.textContent = window.siyuan.languages.testConnectionTesting;
        const restoreBtn = () => {
            testBtn.disabled = false;
            iconUse.setAttribute("xlink:href", "#iconPlugZap");
            svgEl.style.animation = "";
            labelSpan.textContent = window.siyuan.languages.testConnection;
        };
        fetchPost("/api/ai/testEmbeddingModel", {}, (response) => {
            restoreBtn();
            const data = response.data || {};
            if (data.matched) {
                const dims = data.dimensions;
                showMessage(
                    dims
                        ? window.siyuan.languages.testConnectionSuccessDimensions.replace("${dimensions}", String(dims))
                        : window.siyuan.languages.testConnectionSuccess,
                    undefined, "info",
                );
                return;
            }
            showMessage(
                data.msg
                    ? window.siyuan.languages.testConnectionFailMsg.replace("${msg}", data.msg)
                    : window.siyuan.languages.testConnectionFail,
                undefined, "error",
            );
        });
    });
};

// mountRerankTestBtn 在重排「模型」输入框下方注入测试连接按钮，点击后用极简 query+documents 请求重排端点验证连通性。
// 重排配置即时保存，点测试时内核已持最新配置，故无需前端传参。
export const mountRerankTestBtn = (root: HTMLElement) => {
    const inputEl = root.querySelector<HTMLInputElement>('[id="ai.rerank.name"]');
    if (!inputEl) {
        return;
    }
    const wrapper = inputEl.closest(".config-item")?.querySelector(".fn__block");
    if (!wrapper) {
        return;
    }
    const btnContainer = document.createElement("div");
    btnContainer.style.textAlign = "right";
    btnContainer.style.marginTop = "8px";
    btnContainer.innerHTML = `<button class="b3-button b3-button--outline" id="aiRerankTestBtn"><svg class="b3-button__icon"><use xlink:href="#iconPlugZap"></use></svg><span>${window.siyuan.languages.testConnection}</span></button>`;
    wrapper.appendChild(btnContainer);

    const testBtn = btnContainer.querySelector<HTMLButtonElement>("#aiRerankTestBtn");
    const iconUse = testBtn.querySelector("use");
    const svgEl = testBtn.querySelector("svg");
    const labelSpan = testBtn.querySelector("span");
    testBtn.addEventListener("click", () => {
        testBtn.disabled = true;
        iconUse.setAttribute("xlink:href", "#iconRefresh");
        svgEl.style.animation = "agent-mirror-spin 0.8s linear infinite";
        labelSpan.textContent = window.siyuan.languages.testConnectionTesting;
        const restoreBtn = () => {
            testBtn.disabled = false;
            iconUse.setAttribute("xlink:href", "#iconPlugZap");
            svgEl.style.animation = "";
            labelSpan.textContent = window.siyuan.languages.testConnection;
        };
        fetchPost("/api/ai/testRerankModel", {}, (response) => {
            restoreBtn();
            const data = response.data || {};
            if (data.matched) {
                showMessage(window.siyuan.languages.testConnectionSuccess, undefined, "info");
                return;
            }
            showMessage(
                data.msg
                    ? window.siyuan.languages.testConnectionFailMsg.replace("${msg}", data.msg)
                    : window.siyuan.languages.testConnectionFail,
                undefined, "error",
            );
        });
    });
};

export const genProvidersBlockHtml = (): string => `<div class="b3-label config-item" id="aiProvidersBlock">
    <div class="b3-label__text">${window.siyuan.languages.apiProviderTip}</div>
    <div class="fn__hr--small"></div>
    <div id="aiProviderList"></div>
    <div class="fn__hr"></div>
    <div class="config-wrap">
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-type="addAiProvider">
            <svg><use xlink:href="#iconAdd"></use></svg>
            ${window.siyuan.languages.addAiProvider}
        </button>
    </div>
</div>`;

export const mountProvidersBlock = (root: HTMLElement) => {
    const block = root.querySelector("#aiProvidersBlock");
    if (!block) {
        return;
    }
    renderProviderList(root);

    const getProviderId = (el: HTMLElement): string | undefined => {
        return el.closest<HTMLElement>("[data-provider-id]")?.dataset.providerId;
    };
    const getModelId = (el: HTMLElement): string | undefined => {
        return el.closest<HTMLElement>("[data-model-id]")?.dataset.modelId;
    };
    block.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const actionEl = target.closest<HTMLElement>("[data-type]");
        const type = actionEl?.dataset.type;
        if (type === "addAiProvider") {
            openProviderDialog(root, null);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (type === "editAiProvider") {
            const providerId = getProviderId(actionEl);
            if (providerId) {
                openProviderDialog(root, providerId);
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (type === "deleteAiProvider") {
            event.preventDefault();
            event.stopPropagation();
            const providerId = getProviderId(actionEl);
            if (!providerId) {
                return;
            }
            const provider = findProvider(providerId);
            if (!provider) {
                return;
            }
            showDeleteConfirm(provider.displayName || provider.baseURL, () => {
                saveProviders(root, window.siyuan.config.ai.providers.filter((item) => item.id !== providerId));
            });
            return;
        }
        if (type === "addAiModel") {
            const providerId = getProviderId(actionEl);
            if (providerId) {
                openModelDialog(root, providerId, null);
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (type === "editAiModel") {
            const providerId = getProviderId(actionEl);
            const modelId = getModelId(actionEl);
            if (providerId && modelId) {
                openModelDialog(root, providerId, modelId);
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (type === "deleteAiModel") {
            event.preventDefault();
            event.stopPropagation();
            const providerId = getProviderId(actionEl);
            const modelId = getModelId(actionEl);
            if (!providerId || !modelId) {
                return;
            }
            const provider = findProvider(providerId);
            if (!provider) {
                return;
            }
            const model = findModel(provider, modelId);
            if (!model) {
                return;
            }
            showDeleteConfirm(model.displayName || model.name, () => {
                saveProviders(root, window.siyuan.config.ai.providers.map((item) => {
                    if (item.id !== providerId) {
                        return item;
                    }
                    return {
                        ...item,
                        models: item.models.filter((m) => m.id !== modelId),
                    };
                }));
            });
            return;
        }
        if (type === "aiProvider") {
            actionEl.querySelector(".b3-list-item__arrow")?.classList.toggle("b3-list-item__arrow--open");
            actionEl.parentElement?.querySelector(".b3-list__panel")?.classList.toggle("fn__none");
            event.preventDefault();
            event.stopPropagation();
            return;
        }
    });

    block.addEventListener("change", (event) => {
        const target = event.target as HTMLInputElement;
        const type = target.dataset.type;
        const providerId = getProviderId(target);
        if (!providerId || !findProvider(providerId)) {
            return;
        }
        const providers = window.siyuan.config.ai.providers;
        if (type === "toggleAiProvider") {
            const nextProviders = providers.map((item) => {
                if (item.id !== providerId) {
                    return item;
                }
                return {...item, enabled: target.checked};
            });
            aiConfigApi.patch("providers", nextProviders, () => syncModelPickerSelects(root));
            return;
        }
        if (type === "toggleAiModel") {
            const modelId = getModelId(target);
            if (!modelId) {
                return;
            }
            const nextProviders = providers.map((item) => {
                if (item.id !== providerId) {
                    return item;
                }
                return {
                    ...item,
                    models: item.models.map((m) => {
                        if (m.id !== modelId) {
                            return m;
                        }
                        return {...m, enabled: target.checked};
                    }),
                };
            });
            aiConfigApi.patch("providers", nextProviders, () => syncModelPickerSelects(root));
        }
    });
};

const renderProviderList = (root: HTMLElement) => {
    const listEl = root.querySelector("#aiProviderList");
    if (!listEl) {
        return;
    }
    const providers = window.siyuan.config.ai.providers;
    const expanded = new Set<string>();
    if (!listEl.innerHTML) {
        // 初始化时，如果模型总数小于 10，则默认展开所有提供商
        const totalModels = providers.reduce((sum, provider) => sum + provider.models.length, 0);
        if (totalModels < 10) {
            providers.forEach((provider) => {
                if (provider.id) {
                    expanded.add(provider.id);
                }
            });
        }
    } else {
        // 重新渲染时，保持已有提供商的展开状态、新增的提供商默认展开
        const previousProviderIds = new Set<string>();
        root.querySelectorAll<HTMLElement>("[data-provider-id]").forEach((wrapper) => {
            const providerId = wrapper.dataset.providerId;
            if (!providerId) {
                return;
            }
            previousProviderIds.add(providerId);
            const panel = wrapper.querySelector<HTMLElement>(".b3-list__panel");
            if (panel && !panel.classList.contains("fn__none")) {
                expanded.add(providerId);
            }
        });
        providers.forEach((provider) => {
            if (provider.id && !previousProviderIds.has(provider.id)) {
                expanded.add(provider.id);
            }
        });
    }
    const hideActionClass = isMobile() ? "" : " b3-list-item--hide-action";
    if (providers.length === 0) {
        listEl.innerHTML = `<div class="b3-label__text">${window.siyuan.languages.noProviderConfigured}</div>`;
        return;
    }
    const providersHtml = providers.map((provider) => {
        const isExpanded = expanded.has(provider.id!);
        const modelsHtml = provider.models.map((model) => {
            return `<div class="b3-list-item b3-list-item--narrow${hideActionClass}" data-type="aiModel" data-model-id="${model.id}">
    <span class="b3-list-item__text">${Lute.EscapeHTMLStr((model.displayName || model.name))}</span>
    <span data-type="deleteAiModel" class="b3-list-item__action b3-list-item__action--warning b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.delete}">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </span>
    <span data-type="editAiModel" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.config}">
        <svg><use xlink:href="#iconSettings"></use></svg>
    </span>
    <span class="fn__space--small"></span>
    <input class="b3-switch" data-type="toggleAiModel" type="checkbox"${model.enabled ? " checked" : ""}>
</div>`;
        }).join("");

        return `<div data-provider-id="${provider.id}">
    <div class="b3-list-item b3-list-item--narrow${hideActionClass}" data-type="aiProvider">
        <span class="b3-list-item__toggle">
            <svg class="b3-list-item__arrow${isExpanded ? " b3-list-item__arrow--open" : ""}"><use xlink:href="#iconRight"></use></svg>
        </span>
        <span class="b3-list-item__text">${Lute.EscapeHTMLStr((provider.displayName || provider.baseURL))}</span>
        <span data-type="deleteAiProvider" class="b3-list-item__action b3-list-item__action--warning b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.delete}">
            <svg><use xlink:href="#iconTrashcan"></use></svg>
        </span>
        <span data-type="editAiProvider" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.config}">
            <svg><use xlink:href="#iconSettings"></use></svg>
        </span>
        <span class="fn__space--small"></span>
        <input class="b3-switch" data-type="toggleAiProvider" type="checkbox"${provider.enabled ? " checked" : ""}>
    </div>
    <div class="b3-list__panel${isExpanded ? "" : " fn__none"}">
        ${modelsHtml}
        <div class="fn__hr--small"></div>
        <button class="b3-button b3-button--small" data-type="addAiModel">
            <svg><use xlink:href="#iconAdd"></use></svg>
            ${window.siyuan.languages.addAiModel}
        </button>
    </div>
</div>`;
    }).join("");
    listEl.innerHTML = `<div class="b3-list b3-list--border b3-list--background">${providersHtml}</div>`;
};

const showDeleteConfirm = (title: string, onConfirm: () => void) => {
    confirmDialog(
        window.siyuan.languages.deleteOpConfirm,
        window.siyuan.languages.confirmDeleteTip.replace("${x}", Lute.EscapeHTMLStr(title)),
        onConfirm,
        undefined,
        true,
    );
};

const openProviderDialog = (root: HTMLElement, providerId: string | null) => {
    const isNew = !providerId;
    const existingProvider = providerId ? findProvider(providerId) : undefined;
    if (!isNew && !existingProvider) {
        return;
    }
    const initialProvider: Config.IProvider = isNew ? {
        id: "",
        apiKey: "",
        baseURL: "",
        requestTimeout: 120,
        enabled: true,
        models: [],
    } : existingProvider;

    const dialog = new Dialog({
        title: isNew ? window.siyuan.languages.addAiProvider : window.siyuan.languages.aiProviderSettings,
        width: isMobile() ? "92vw" : "520px",
        height: "80vh",
        content: `<div class="b3-dialog__content">
    <div class="b3-label b3-label--inner">
        <div class="config-name">${window.siyuan.languages.apiBaseURL}</div>
        <div class="b3-label__text">${window.siyuan.languages.apiBaseURLTip}</div>
        <div class="fn__hr"></div>
        <input class="b3-text-field fn__block" id="aiProviderBaseURL" type="text" spellcheck="false" value="${Lute.EscapeHTMLStr(initialProvider.baseURL)}"/>
    </div>
    <div class="b3-label b3-label--inner">
        <div class="config-name">${window.siyuan.languages.customDisplayName}</div>
        <div class="b3-label__text">${window.siyuan.languages.aiProviderDisplayNameTip}</div>
        <div class="fn__hr"></div>
        <input class="b3-text-field fn__block" id="aiProviderDisplayName" type="text" spellcheck="false" value="${Lute.EscapeHTMLStr(initialProvider.displayName ?? "")}"/>
    </div>
    <div class="b3-label b3-label--inner">
        <div class="config-name">${window.siyuan.languages.apiKey}</div>
        <div class="b3-label__text">${window.siyuan.languages.apiKeyTip}</div>
        <div class="fn__hr"></div>
        <div class="b3-form__icona fn__block">
            <input id="aiProviderApiKey" type="password" class="b3-text-field b3-form__icona-input" value="${Lute.EscapeHTMLStr(initialProvider.apiKey)}">
            <svg class="b3-form__icona-icon" data-action="togglePassword" style="user-select: none;"><use xlink:href="#iconEye"></use></svg>
        </div>
    </div>
    <div class="b3-label b3-label--inner">
        <div class="config-name">${window.siyuan.languages.apiTimeout}</div>
        <div class="b3-label__text">${window.siyuan.languages.apiTimeoutTip}</div>
        <div class="fn__hr"></div>
        <div class="fn__flex">
            <input class="b3-text-field fn__flex-1" id="aiProviderRequestTimeout" type="number" min="1" max="600" value="${initialProvider.requestTimeout}"/>
            <span class="fn__space"></span>
            <span class="ft__on-surface fn__flex-center">s</span>
        </div>
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_AIPROVIDER);
    bindPasswordIconaToggle(dialog.element, "aiProviderApiKey");
    dialog.element.querySelector<HTMLInputElement>("#aiProviderBaseURL").select();
    const btns = dialog.element.querySelectorAll(".b3-dialog__action .b3-button");
    btns[0].addEventListener("click", () => dialog.destroy());
    btns[1].addEventListener("click", () => {
        const nextProvider: Config.IProvider = {
            ...initialProvider,
            baseURL: dialog.element.querySelector<HTMLInputElement>("#aiProviderBaseURL").value,
            displayName: dialog.element.querySelector<HTMLInputElement>("#aiProviderDisplayName").value,
            apiKey: dialog.element.querySelector<HTMLInputElement>("#aiProviderApiKey").value,
            requestTimeout: dialog.element.querySelector<HTMLInputElement>("#aiProviderRequestTimeout").valueAsNumber,
        };
        const providers = window.siyuan.config.ai.providers;
        const nextProviders = isNew
            ? [...providers, nextProvider]
            : providers.map((item) => item.id !== providerId ? item : nextProvider);
        saveProviders(root, nextProviders);
        dialog.destroy();
    });
};

const findProvider = (providerId: string) =>
    window.siyuan.config.ai.providers.find((provider) => provider.id === providerId);

const findModel = (provider: Config.IProvider, modelId: string) =>
    provider.models.find((model) => model.id === modelId);

const saveProviders = (root: HTMLElement, providers: Config.IProvider[]) => {
    aiConfigApi.patch("providers", providers, () => {
        renderProviderList(root);
        syncModelPickerSelects(root);
    });
};

// 提供商或模型变更后，将各场景模型选择器与配置对齐，并在必要时修正已保存的 modelId
const syncModelPickerSelects = (root: HTMLElement) => {
    const enabledProviders = getEnabledProviders();
    (["editing", "agent", "vision", "imageGeneration"] as const).forEach((group) => {
        const blockEl = root.querySelector<HTMLElement>(`#${CSS.escape(`aiModelPickerBlock-${group}`)}`);
        if (!blockEl) {
            return;
        }
        const providerSelect = blockEl.querySelector<HTMLSelectElement>("[data-type='modelPickerProvider']");
        const modelSelect = blockEl.querySelector<HTMLSelectElement>("[data-type='modelPickerModel']");
        if (!providerSelect || !modelSelect) {
            return;
        }
        // 数据源：当前 UI 下拉框选中值、持久化配置
        const uiProviderId = providerSelect.value;
        const uiModelId = modelSelect.value;
        const savedModelId = window.siyuan.config.ai[group].modelId;
        const {providerId: savedProviderId, modelId: storedModelId} = lookupModelOwner(savedModelId);

        // 提供商优先级：UI 选中（已启用）→ 配置归属（已启用）→ 空
        const providerId = pickProviderId(enabledProviders, [uiProviderId, savedProviderId]);
        const enabledModels = getEnabledModels(providerId);
        // 模型优先级：UI 选中 → 配置保存值，无效时回退到第一个可用模型
        const modelId = pickModelId(enabledModels, [uiModelId, storedModelId]);

        // 重建提供商下拉选项
        providerSelect.disabled = enabledProviders.length === 0;
        providerSelect.innerHTML = buildProviderOptionsHtml(enabledProviders, providerId);
        providerSelect.value = providerId;
        // 重建模型下拉选项
        modelSelect.disabled = !providerId || enabledModels.length === 0;
        modelSelect.innerHTML = buildModelOptionsHtml(enabledModels, modelId);
        modelSelect.value = modelId;

        // 原 modelId 已失效（被删、禁用等）时写回修正值，提供商或模型无效则清空
        if (modelId !== savedModelId) {
            const nextModelId = !providerId || !modelId ? "" : modelId;
            aiConfigApi.patch(`${group}.modelId`, nextModelId);
        }
    });
};

// 根据 modelId 反查其所属提供商
const lookupModelOwner = (modelId: string): {providerId: string; modelId: string} => {
    if (!modelId) {
        return {providerId: "", modelId: ""};
    }
    const provider = window.siyuan.config.ai.providers.find((item) => findModel(item, modelId));
    if (!provider) {
        return {providerId: "", modelId: ""};
    }
    return {providerId: provider.id, modelId};
};

const getEnabledProviders = () =>
    window.siyuan.config.ai.providers.filter((provider) => provider.enabled);

const getEnabledModels = (providerId: string): Config.IModel[] => {
    const provider = findProvider(providerId);
    if (!provider) {
        return [];
    }
    return provider.models.filter((model) => model.enabled);
};

const buildProviderOptionsHtml = (enabledProviders: Config.IProvider[], providerId: string): string =>
    `<option value="">${window.siyuan.languages.noProviderConfigured}</option>` +
    enabledProviders.map(provider =>
        `<option value="${Lute.EscapeHTMLStr(provider.id)}"${provider.id === providerId ? " selected" : ""}>${Lute.EscapeHTMLStr(provider.displayName || provider.baseURL)}</option>`
    ).join("");

const buildModelOptionsHtml = (enabledModels: Config.IModel[], modelId: string): string =>
    `<option value="">${window.siyuan.languages.noModelConfigured}</option>` +
    enabledModels.map((model) =>
        `<option value="${Lute.EscapeHTMLStr(model.id)}"${model.id === modelId ? " selected" : ""}>${Lute.EscapeHTMLStr(model.displayName || model.name)}</option>`
    ).join("");

// 在已启用提供商列表中按优先级选取 providerId，均无效时返回空
const pickProviderId = (enabledProviders: Config.IProvider[], preferredProviderIds: string[]): string => {
    for (const preferredProviderId of preferredProviderIds) {
        if (preferredProviderId && enabledProviders.some((provider) => provider.id === preferredProviderId)) {
            return preferredProviderId;
        }
    }
    return "";
};

// 在可用模型列表中按优先级选取 modelId，均无效时取第一个
const pickModelId = (enabledModels: Config.IModel[], preferredModelIds: string[]): string => {
    if (enabledModels.length === 0) {
        return "";
    }
    for (const preferredModelId of preferredModelIds) {
        if (preferredModelId && enabledModels.some((model) => model.id === preferredModelId)) {
            return preferredModelId;
        }
    }
    return enabledModels[0].id ?? "";
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
        ${models.map((model) => `<div class="b3-list-item b3-list-item--narrow" data-model="${Lute.EscapeHTMLStr(model)}">
    <span class="b3-list-item__text">${Lute.EscapeHTMLStr(model)}</span>
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

const replaceModelInputWithPicker = (inputElement: HTMLElement, models: string[], current: string) => {
    const modelInput = document.createElement("input");
    modelInput.className = "b3-select fn__flex-1";
    modelInput.id = "aiModelName";
    modelInput.type = "text";
    modelInput.spellcheck = false;
    modelInput.readOnly = true;
    modelInput.placeholder = window.siyuan.languages.selectModel;
    modelInput.value = current && models.includes(current) ? current : "";
    const openMenu = () => openAvailableModelMenu(modelInput, models);
    modelInput.addEventListener("click", openMenu);
    modelInput.addEventListener("keydown", (event) => {
        if (["Enter", " ", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            openMenu();
        }
    });
    inputElement.replaceWith(modelInput);
};

const openModelDialog = (root: HTMLElement, providerId: string, modelId: string | null) => {
    const provider = findProvider(providerId);
    if (!provider) {
        return;
    }
    const isNew = !modelId;
    const initialModel: Config.IModel | undefined = isNew ? {
        id: "",
        name: "",
        enabled: true,
    } : provider.models.find((item) => item.id === modelId);
    if (!isNew && !initialModel) {
        return;
    }

    const dialog = new Dialog({
        title: isNew ? window.siyuan.languages.addAiModel : window.siyuan.languages.aiModelSettings,
        width: isMobile() ? "92vw" : "520px",
        height: "80vh",
        content: `<div class="b3-dialog__content">
    <div class="b3-label b3-label--inner">
        <div class="config-name">${window.siyuan.languages.apiModel}</div>
        <div class="b3-label__text">${window.siyuan.languages.apiModelTip}</div>
        <div class="fn__hr"></div>
        <div class="fn__flex config-wrap" style="overflow: visible !important;">
            <button class="b3-button b3-button--outline fn__flex-center" id="aiModelFetchBtn" title="${window.siyuan.languages.fetchAvailableModels}"><svg style="margin-right: 4px;"><use xlink:href="#iconRefresh"></use></svg>${window.siyuan.languages.fetchAvailableModels}</button>
            <span class="fn__space"></span>
            <input class="b3-text-field fn__flex-1" id="aiModelName" type="text" spellcheck="false" value="${Lute.EscapeHTMLStr(initialModel.name)}"/>
        </div>
    </div>
    <div class="b3-label b3-label--inner">
        <div class="config-name">${window.siyuan.languages.customDisplayName}</div>
        <div class="b3-label__text">${window.siyuan.languages.aiModelDisplayNameTip}</div>
        <div class="fn__hr"></div>
        <input class="b3-text-field fn__block" id="aiModelDisplayName" type="text" spellcheck="false" value="${Lute.EscapeHTMLStr(initialModel.displayName ?? "")}"/>
    </div>
    <div style="text-align: right;">
        <button class="b3-button b3-button--outline" id="aiModelTestBtn"><svg class="b3-button__icon"><use xlink:href="#iconPlugZap"></use></svg><span>${window.siyuan.languages.testConnection}</span></button>
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_AIMODEL);
    dialog.element.querySelector<HTMLInputElement>("#aiModelName")?.select();
    const btns = dialog.element.querySelectorAll(".b3-dialog__action .b3-button");
    // 读取模型名称当前值：该字段可能是文本输入框（初始或拉取失败回退），也可能是拉取成功后替换成的下拉框
    const getModelName = () => {
        const el = dialog.element.querySelector<HTMLInputElement | HTMLSelectElement>("#aiModelName");
        return (el?.value ?? "").trim();
    };
    btns[0].addEventListener("click", () => dialog.destroy());
    // 拉取 Provider 可用模型清单，成功后把文本框替换为下拉框供选择
    dialog.element.querySelector<HTMLElement>("#aiModelFetchBtn")?.addEventListener("click", () => {
        const fetchBtn = dialog.element.querySelector<HTMLButtonElement>("#aiModelFetchBtn");
        const fetchSvg = fetchBtn.querySelector("svg");
        const originalHtml = fetchBtn.innerHTML;
        fetchBtn.disabled = true;
        fetchSvg.style.animation = "agent-mirror-spin 0.8s linear infinite";
        const restoreFetchBtn = () => {
            fetchBtn.disabled = false;
            fetchBtn.innerHTML = originalHtml;
        };
        fetchPost("/api/ai/listModels", {provider: providerId}, (response) => {
            restoreFetchBtn();
            const data = response.data || {};
            const models: string[] = Array.isArray(data.models) ? data.models : [];
            if (models.length === 0) {
                showMessage(`${window.siyuan.languages.fetchAvailableModelsFail}${data.msg ? "：" + data.msg : ""}`, undefined, "error");
                return;
            }
            // 用可搜索选择器替换原文本框，保留当前已填值
            const current = getModelName();
            const inputEl = dialog.element.querySelector<HTMLElement>("#aiModelName");
            replaceModelInputWithPicker(inputEl, models, current);
            showMessage(window.siyuan.languages.fetchAvailableModelsSuccess, undefined, "info");
        });
    });
    dialog.element.querySelector<HTMLElement>("#aiModelTestBtn")?.addEventListener("click", () => {
        const modelName = getModelName();
        if (!modelName) {
            showMessage(window.siyuan.languages.testConnectionFailModelRequired);
            return;
        }
        const testBtn = dialog.element.querySelector<HTMLButtonElement>("#aiModelTestBtn");
        const iconUse = testBtn.querySelector("use");
        const svgEl = testBtn.querySelector("svg");
        const labelSpan = testBtn.querySelector("span");
        const originalHref = iconUse.getAttribute("xlink:href");
        testBtn.disabled = true;
        iconUse.setAttribute("xlink:href", "#iconRefresh");
        svgEl.style.animation = "agent-mirror-spin 0.8s linear infinite";
        labelSpan.textContent = window.siyuan.languages.testConnectionTesting;
        const restoreBtn = () => {
            testBtn.disabled = false;
            iconUse.setAttribute("xlink:href", originalHref);
            svgEl.style.animation = "";
            labelSpan.textContent = window.siyuan.languages.testConnection;
        };
        fetchPost("/api/ai/testModel", {provider: providerId, model: modelName}, (response) => {
            restoreBtn();
            const data = response.data || {};
            if (data.matched) {
                showMessage(window.siyuan.languages.testConnectionSuccess, undefined, "info");
                return;
            }
            const available = data.available;
            if (Array.isArray(available) && available.length > 0) {
                showMessage(`${window.siyuan.languages.testConnectionFailModelNotFound}（${available.slice(0, 10).join(", ")}）`, undefined, "error");
                return;
            }
            showMessage(
                data.msg
                    ? window.siyuan.languages.testConnectionFailMsg.replace("${msg}", data.msg)
                    : window.siyuan.languages.testConnectionFail,
                undefined, "error",
            );
        });
    });
    btns[1].addEventListener("click", () => {
        const modelName = getModelName();
        if (!modelName) {
            showMessage(window.siyuan.languages.testConnectionFailModelRequired);
            return;
        }
        const nextModel: Config.IModel = {
            ...initialModel,
            name: modelName,
            displayName: dialog.element.querySelector<HTMLInputElement>("#aiModelDisplayName").value,
        };
        const nextProviders = window.siyuan.config.ai.providers.map((item) => {
            if (item.id !== providerId) {
                return item;
            }
            const nextModels = isNew
                ? [...item.models, nextModel]
                : item.models.map((m) => m.id !== modelId ? m : nextModel);
            return {...item, models: nextModels};
        });
        saveProviders(root, nextProviders);
        dialog.destroy();
    });
};

export const getModelPickerKeywords = (group: ModelPickerGroup): string[] => {
    const keywords = [
        window.siyuan.languages.defaultModel,
        window.siyuan.languages.apiProvider,
        window.siyuan.languages.apiModel,
        window.siyuan.languages.noProviderConfigured,
        window.siyuan.languages.noModelConfigured,
    ];
    if (group === "editing") {
        keywords.push(
            window.siyuan.languages.aiEditingModelPickerTip
        );
    } else if (group === "agent") {
        keywords.push(
            window.siyuan.languages.aiAgentModelPickerTip,
            window.siyuan.languages.agentChat,
        );
    } else if (group === "vision") {
        keywords.push(window.siyuan.languages.aiImageUnderstanding, window.siyuan.languages.aiImageUnderstandingTip);
    } else {
        keywords.push(window.siyuan.languages.aiImageGeneration, window.siyuan.languages.aiImageGenerationTip);
    }
    return keywords;
};

export const genModelPickerHtml = (group: ModelPickerGroup): string => {
    const savedModelId = window.siyuan.config.ai[group].modelId;
    const {providerId, modelId: storedModelId} = lookupModelOwner(savedModelId);
    const enabledProviders = getEnabledProviders();
    const enabledModels = getEnabledModels(providerId);
    const modelId = pickModelId(enabledModels, [storedModelId]);
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

    return `<div class="b3-label config-item" id="aiModelPickerBlock-${group}" data-type="aiModelPicker" data-name="${group}">
    <div class="fn__block">
        <div class="config-name">${window.siyuan.languages.defaultModel}</div>
        <div class="b3-label__text">${desc}</div>
        <div class="fn__hr--small"></div>
        <div class="fn__flex">
            <select class="b3-select fn__flex-1" id="ai.__modelPicker.${group}.provider" data-type="modelPickerProvider" data-group="${group}"${enabledProviders.length === 0 ? " disabled" : ""}>
                ${buildProviderOptionsHtml(enabledProviders, providerId)}
            </select>
            <span class="fn__space"></span>
            <select class="b3-select fn__flex-1" id="ai.__modelPicker.${group}.model" data-type="modelPickerModel" data-group="${group}"${!providerId || enabledModels.length === 0 ? " disabled" : ""}>
                ${buildModelOptionsHtml(enabledModels, modelId)}
            </select>
        </div>
    </div>
</div>`;
};

export const mountModelPickerBlock = (root: HTMLElement, group: ModelPickerGroup) => {
    const blockEl = root.querySelector(`#${CSS.escape(`aiModelPickerBlock-${group}`)}`);
    if (!blockEl) {
        return;
    }
    blockEl.addEventListener("change", (event) => {
        const selectEl = event.target as HTMLSelectElement;
        if (selectEl.dataset.group !== group) {
            return;
        }
        const rowEl = selectEl.closest<HTMLElement>("[data-type='aiModelPicker']");
        if (!rowEl) {
            return;
        }
        const providerSelect = rowEl.querySelector<HTMLSelectElement>("[data-type='modelPickerProvider']");
        const modelSelect = rowEl.querySelector<HTMLSelectElement>("[data-type='modelPickerModel']");
        if (!providerSelect || !modelSelect) {
            return;
        }
        const providerId = providerSelect.value;
        const {modelId: storedModelId} = lookupModelOwner(window.siyuan.config.ai[group].modelId);
        const enabledModels = getEnabledModels(providerId);
        const isProviderChange = selectEl.dataset.type === "modelPickerProvider";
        const modelId = pickModelId(enabledModels, isProviderChange ? [storedModelId] : [modelSelect.value]);
        if (isProviderChange) {
            modelSelect.disabled = !providerId || enabledModels.length === 0;
            modelSelect.innerHTML = buildModelOptionsHtml(enabledModels, modelId);
        }
        modelSelect.value = modelId;
        const nextModelId = !providerId || !modelId ? "" : modelId;
        aiConfigApi.patch(`${group}.modelId`, nextModelId);
    });
};

export const getMcpServersBlockKeywords = (): string[] => [
    window.siyuan.languages.mcpStatusConnected,
    window.siyuan.languages.mcpStatusConnecting,
    window.siyuan.languages.mcpStatusAuthorizing,
    window.siyuan.languages.mcpStatusAuthorizationRequired,
    window.siyuan.languages.mcpStatusFailed,
    window.siyuan.languages.mcpStatusDisabled,
    window.siyuan.languages.mcpStatusTools,
    window.siyuan.languages.aiMcpServersTip,
    window.siyuan.languages.addAiMcpServer,
    window.siyuan.languages.aiMcpServerSettings,
    window.siyuan.languages.noMcpServerConfigured,
    window.siyuan.languages.aiMcpServerName,
    window.siyuan.languages.aiMcpServerNameTip,
    window.siyuan.languages.connectionType,
    window.siyuan.languages.aiMcpTypeStdio,
    window.siyuan.languages.aiMcpTypeHttp,
    window.siyuan.languages.command,
    window.siyuan.languages.aiMcpCommandTip,
    window.siyuan.languages.args,
    window.siyuan.languages.aiMcpArgsTip,
    window.siyuan.languages.aiMcpUrlTip,
    window.siyuan.languages.aiMcpHttpHeaders,
    window.siyuan.languages.apiTimeout,
    window.siyuan.languages.mcpAuthorize,
    window.siyuan.languages.mcpDisconnectAuthorization,
];

const openedMcpOAuthURLs = new Map<string, string>();

export const genMcpServersBlockHtml = (): string => `<div class="b3-label config-item" id="aiMcpServersBlock">
    <div class="fn__flex" style="align-items:center;">
        <span class="b3-label__text">${window.siyuan.languages.aiMcpServersTip}</span>
        <span class="fn__flex-1"></span>
        <span id="aiMcpStatusSummary" class="b3-label__text ft__on-surface fn__none"></span>
    </div>
    <div class="fn__hr--small"></div>
    <div id="aiMcpServerList"></div>
    <div class="fn__hr"></div>
    <div class="config-wrap">
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-type="addAiMcpServer">
            <svg><use xlink:href="#iconAdd"></use></svg>
            ${window.siyuan.languages.addAiMcpServer}
        </button>
    </div>
</div>`;

export const mountMcpServersBlock = (root: HTMLElement) => {
    const block = root.querySelector("#aiMcpServersBlock");
    if (!block) {
        return;
    }
    renderMcpServerList(root);

    // 轮询 MCP 连接状态，刷新每个 server 名称旁的状态圆点颜色、tooltip，以及标题右侧的汇总。
    const renderMcpStatus = () => {
        fetchPost("/api/ai/mcpStatus", {}, (response) => {
            const items = response.data as Array<{
                id: string;
                name: string;
                status: string;
                tools: number;
                error?: string;
                authorizationURL?: string;
                authorized: boolean;
            }>;
            if (!items) {
                return;
            }
            const colorMap: Record<string, string> = {
                connected: "#65b84f",
                connecting: "#d97706",
                authorizing: "#d97706",
                authorization_required: "#d97706",
                failed: "#d23f31",
                disabled: "var(--b3-theme-on-surface-light)",
            };
            let connectedCount = 0;
            let totalTools = 0;
            for (const item of items) {
                if (item.status === "connected") {
                    connectedCount++;
                    totalTools += item.tools;
                }
                if (item.authorizationURL && openedMcpOAuthURLs.get(item.id) !== item.authorizationURL) {
                    openedMcpOAuthURLs.set(item.id, item.authorizationURL);
                    /// #if !BROWSER
                    void shell.openExternal(item.authorizationURL).catch((error: Error) => {
                        if (openedMcpOAuthURLs.get(item.id) === item.authorizationURL) {
                            openedMcpOAuthURLs.delete(item.id);
                        }
                        showMessage(error.message);
                    });
                    /// #else
                    openByMobile(item.authorizationURL);
                    /// #endif
                }
                const dotWrap = block.querySelector<HTMLElement>(`[data-mcp-status-id="${CSS.escape(item.id)}"]`);
                if (!dotWrap) {
                    continue;
                }
                const dot = dotWrap.firstElementChild as HTMLElement;
                if (dot) {
                    dot.style.backgroundColor = colorMap[item.status] || colorMap.disabled;
                }
                // 每个 server 行上显示其工具数（仅已连接且有工具时）。
                const toolsEl = block.querySelector<HTMLElement>(`[data-mcp-tools-count="${CSS.escape(item.id)}"]`);
                if (toolsEl) {
                    toolsEl.textContent = item.status === "connected" && item.tools > 0 ? window.siyuan.languages.mcpStatusTools.replace("${x}", String(item.tools)) : "";
                }
                let label: string;
                switch (item.status) {
                    case "connected":
                        label = window.siyuan.languages.mcpStatusConnected;
                        break;
                    case "connecting":
                        label = window.siyuan.languages.mcpStatusConnecting;
                        break;
                    case "authorizing":
                        label = window.siyuan.languages.mcpStatusAuthorizing;
                        break;
                    case "authorization_required":
                        label = window.siyuan.languages.mcpStatusAuthorizationRequired;
                        break;
                    case "failed":
                        label = window.siyuan.languages.mcpStatusFailed;
                        break;
                    default:
                        label = window.siyuan.languages.mcpStatusDisabled;
                }
                dotWrap.setAttribute("aria-label", item.error ? `${label}: ${item.error}` : label);
                block.querySelector<HTMLElement>(`[data-mcp-authorize-id="${CSS.escape(item.id)}"]`)?.classList.toggle("fn__none", item.status !== "authorization_required");
                block.querySelector<HTMLElement>(`[data-mcp-disconnect-oauth-id="${CSS.escape(item.id)}"]`)?.classList.toggle("fn__none", !item.authorized);
            }
            const configuredServerIDs = new Set(items.map((item) => item.id));
            for (const serverID of openedMcpOAuthURLs.keys()) {
                if (!configuredServerIDs.has(serverID)) {
                    openedMcpOAuthURLs.delete(serverID);
                }
            }
            // 标题右侧汇总：已连接 server 数 + 总工具数。
            const summaryEl = block.querySelector<HTMLElement>("#aiMcpStatusSummary");
            if (summaryEl) {
                if (connectedCount > 0) {
                    summaryEl.textContent = window.siyuan.languages.mcpStatusConnected + " " + connectedCount + "/" + items.length + " · " + window.siyuan.languages.mcpStatusTools.replace("${x}", String(totalTools));
                    summaryEl.classList.remove("fn__none");
                } else {
                    summaryEl.classList.add("fn__none");
                }
            }
        });
    };
    renderMcpStatus();
    const statusTimer = window.setInterval(renderMcpStatus, 3000);
    // 设置页关闭/切换时清理定时器，避免内存泄漏（与 embedding 轮询清理模式一致）。
    const cleanupStatus = () => {
        if (!document.contains(block)) {
            window.clearInterval(statusTimer);
            return;
        }
        window.requestAnimationFrame(cleanupStatus);
    };
    window.requestAnimationFrame(cleanupStatus);

    const getMcpServerName = (el: HTMLElement): string | undefined => {
        return el.closest<HTMLElement>("[data-mcp-server-name]")?.dataset.mcpServerName;
    };
    const getMcpServerID = (el: HTMLElement): string | undefined => {
        return el.closest<HTMLElement>("[data-mcp-server-id]")?.dataset.mcpServerId;
    };
    block.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const actionEl = target.closest<HTMLElement>("[data-type]");
        const type = actionEl?.dataset.type;
        if (type === "addAiMcpServer") {
            openMcpServerDialog(root, null);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (type === "editAiMcpServer") {
            const serverName = getMcpServerName(actionEl);
            if (serverName) {
                openMcpServerDialog(root, serverName);
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (type === "deleteAiMcpServer") {
            event.preventDefault();
            event.stopPropagation();
            const serverName = getMcpServerName(actionEl);
            if (!serverName) {
                return;
            }
            const server = findMcpServer(serverName);
            if (!server) {
                return;
            }
            showDeleteConfirm(server.name, () => {
                saveMcpServers(root, window.siyuan.config.ai.mcp.servers.filter((item) => item.name !== serverName));
            });
            return;
        }
        if (type === "authorizeAiMcpServer") {
            const serverID = getMcpServerID(actionEl);
            if (serverID) {
                fetchPost("/api/ai/mcpOAuthAuthorize", {id: serverID}, (response) => {
                    if (response.code !== 0) {
                        showMessage(response.msg);
                    }
                });
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (type === "disconnectAiMcpOAuth") {
            const serverID = getMcpServerID(actionEl);
            if (serverID) {
                confirmDialog(window.siyuan.languages.mcpDisconnectAuthorization,
                    window.siyuan.languages.mcpDisconnectAuthorizationConfirm, () => {
                        fetchPost("/api/ai/mcpOAuthDisconnect", {id: serverID}, (response) => {
                            if (response.code !== 0) {
                                showMessage(response.msg);
                            }
                        });
                    });
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }
    });

    block.addEventListener("change", (event) => {
        const target = event.target as HTMLInputElement;
        const type = target.dataset.type;
        const serverName = getMcpServerName(target);
        if (!serverName || !findMcpServer(serverName)) {
            return;
        }
        if (type === "toggleAiMcpServer") {
            const nextServers = window.siyuan.config.ai.mcp.servers.map((item) => {
                if (item.name !== serverName) {
                    return item;
                }
                return {...item, enabled: target.checked};
            });
            aiConfigApi.patch("mcp.servers", nextServers, () => renderMcpServerList(root));
        }
    });
};

const renderMcpServerList = (root: HTMLElement) => {
    const listEl = root.querySelector("#aiMcpServerList");
    if (!listEl) {
        return;
    }
    const servers = window.siyuan.config.ai.mcp.servers;
    const hideActionClass = isMobile() ? "" : " b3-list-item--hide-action";
    if (servers.length === 0) {
        listEl.innerHTML = `<div class="b3-label__text">${window.siyuan.languages.noMcpServerConfigured}</div>`;
        return;
    }
    const serversHtml = servers.map((server) => {
        return `<div class="b3-list-item b3-list-item--narrow${hideActionClass}" data-type="aiMcpServer" data-mcp-server-id="${Lute.EscapeHTMLStr(server.id)}" data-mcp-server-name="${Lute.EscapeHTMLStr(server.name)}">
    <span class="mcp-status-dot b3-tooltips b3-tooltips__n" data-mcp-status-id="${Lute.EscapeHTMLStr(server.id)}" aria-label="${server.enabled ? window.siyuan.languages.mcpStatusConnecting : window.siyuan.languages.mcpStatusDisabled}" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex-shrink:0;margin-right:4px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:${server.enabled ? "#d97706" : "var(--b3-theme-on-surface-light)"};"></span></span>
    <span class="b3-list-item__text">${Lute.EscapeHTMLStr(server.name)}</span>
    <span class="ft__on-surface fn__flex-center" data-mcp-tools-count="${Lute.EscapeHTMLStr(server.id)}" style="font-size:12px;margin-right:8px;"></span>
    <span data-type="authorizeAiMcpServer" data-mcp-authorize-id="${Lute.EscapeHTMLStr(server.id)}" class="fn__none b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.mcpAuthorize}">
        <svg><use xlink:href="#iconKey"></use></svg>
    </span>
    <span data-type="disconnectAiMcpOAuth" data-mcp-disconnect-oauth-id="${Lute.EscapeHTMLStr(server.id)}" class="fn__none b3-list-item__action b3-list-item__action--warning b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.mcpDisconnectAuthorization}">
        <svg><use xlink:href="#iconLinkOff"></use></svg>
    </span>
    <span data-type="deleteAiMcpServer" class="b3-list-item__action b3-list-item__action--warning b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.delete}">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </span>
    <span data-type="editAiMcpServer" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.config}">
        <svg><use xlink:href="#iconSettings"></use></svg>
    </span>
    <span class="fn__space--small"></span>
    <input class="b3-switch" data-type="toggleAiMcpServer" type="checkbox"${server.enabled ? " checked" : ""}>
</div>`;
    }).join("");
    listEl.innerHTML = `<div class="b3-list b3-list--border b3-list--background">${serversHtml}</div>`;
};

const openMcpServerDialog = (root: HTMLElement, serverName: string | null) => {
    const isNew = !serverName;
    const existingServer = serverName ? findMcpServer(serverName) : undefined;
    if (!isNew && !existingServer) {
        return;
    }
    const initialServer: Config.IMCPServer = isNew ? {
        id: "",
        name: "",
        enabled: true,
        type: "stdio",
        command: "",
        args: [],
        url: "",
        headers: {},
        timeout: 30,
        trustToolAnnotations: false,
    } : existingServer;
    const mcpTypeHidden = (fieldType: string) => initialServer.type !== fieldType ? " fn__none" : "";
    const argsText = (initialServer.args ?? []).join("\n");
    const headersText = Object.keys(initialServer.headers ?? {}).length === 0
        ? ""
        : JSON.stringify(initialServer.headers, null, 2);

    const dialog = new Dialog({
        title: isNew ? window.siyuan.languages.addAiMcpServer : window.siyuan.languages.aiMcpServerSettings,
        width: isMobile() ? "92vw" : "520px",
        height: "80vh",
        content: `<div class="b3-dialog__content">
    <div class="b3-label b3-label--inner">
        <div class="config-name">${window.siyuan.languages.aiMcpServerName}</div>
        <div class="b3-label__text">${window.siyuan.languages.aiMcpServerNameTip}</div>
        <div class="fn__hr"></div>
        <input class="b3-text-field fn__block" id="aiMcpServerName" type="text" spellcheck="false" value="${Lute.EscapeHTMLStr(initialServer.name)}"/>
    </div>
    <div class="b3-label b3-label--inner">
        <div class="config-name">${window.siyuan.languages.connectionType}</div>
        <div class="fn__hr"></div>
        <select class="b3-select fn__block" id="aiMcpServerType">
            <option value="stdio"${initialServer.type === "stdio" ? " selected" : ""}>${window.siyuan.languages.aiMcpTypeStdio}</option>
            <option value="http"${initialServer.type === "http" ? " selected" : ""}>${window.siyuan.languages.aiMcpTypeHttp}</option>
        </select>
    </div>
    <div class="b3-label b3-label--inner${mcpTypeHidden("stdio")}" data-mcp-type="stdio">
        <div class="config-name">${window.siyuan.languages.command}</div>
        <div class="b3-label__text">${window.siyuan.languages.aiMcpCommandTip}</div>
        <div class="fn__hr"></div>
        <input class="b3-text-field fn__block" id="aiMcpServerCommand" type="text" spellcheck="false" value="${Lute.EscapeHTMLStr(initialServer.command)}"/>
    </div>
    <div class="b3-label b3-label--inner${mcpTypeHidden("stdio")}" data-mcp-type="stdio">
        <div class="config-name">${window.siyuan.languages.args}</div>
        <div class="b3-label__text">${window.siyuan.languages.aiMcpArgsTip}</div>
        <div class="fn__hr"></div>
        <textarea class="b3-text-field fn__block" id="aiMcpServerArgs" rows="4" style="resize: vertical;">${Lute.EscapeHTMLStr(argsText)}</textarea>
    </div>
    <div class="b3-label b3-label--inner${mcpTypeHidden("http")}" data-mcp-type="http">
        <div class="config-name">URL</div>
        <div class="b3-label__text">${window.siyuan.languages.aiMcpUrlTip}</div>
        <div class="fn__hr"></div>
        <input class="b3-text-field fn__block" id="aiMcpServerUrl" type="text" spellcheck="false" value="${Lute.EscapeHTMLStr(initialServer.url)}"/>
    </div>
    <div class="b3-label b3-label--inner${mcpTypeHidden("http")}" data-mcp-type="http">
        <div class="config-name">${window.siyuan.languages.aiMcpHttpHeaders}</div>
        <div class="b3-label__text">${window.siyuan.languages.fillJsonObject}</div>
        <div class="fn__hr"></div>
        <textarea class="b3-text-field fn__block" id="aiMcpServerHeaders" rows="3" style="resize: vertical;" placeholder='{"Authorization":"Bearer ..."}'>${Lute.EscapeHTMLStr(headersText)}</textarea>
    </div>
    <div class="b3-label b3-label--inner">
        <div class="config-name">${window.siyuan.languages.apiTimeout}</div>
        <div class="fn__hr"></div>
        <div class="fn__flex">
            <input class="b3-text-field fn__flex-1" id="aiMcpServerTimeout" type="number" min="1" max="600" value="${initialServer.timeout}"/>
            <span class="fn__space"></span>
            <span class="ft__on-surface fn__flex-center">s</span>
        </div>
    </div>
    <div class="b3-label b3-label--inner fn__flex">
        <div class="fn__flex-1">
            <div class="config-name">${window.siyuan.languages.aiMcpTrustToolAnnotations}</div>
            <div class="b3-label__text">${window.siyuan.languages.aiMcpTrustToolAnnotationsTip}</div>
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" id="aiMcpTrustToolAnnotations" type="checkbox"${initialServer.trustToolAnnotations ? " checked" : ""}/>
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_AIMCPSERVER);
    dialog.element.querySelector<HTMLInputElement>("#aiMcpServerName").select();
    dialog.element.querySelector<HTMLSelectElement>("#aiMcpServerType").addEventListener("change", (event) => {
        syncMcpTypeFields(dialog.element, (event.target as HTMLSelectElement).value);
    });
    const btns = dialog.element.querySelectorAll(".b3-dialog__action .b3-button");
    btns[0].addEventListener("click", () => dialog.destroy());
    btns[1].addEventListener("click", () => {
        let headers: Record<string, string> = {};
        const headersTrimmed = dialog.element.querySelector<HTMLTextAreaElement>("#aiMcpServerHeaders").value.trim();
        if (headersTrimmed) {
            try {
                const parsed = JSON.parse(headersTrimmed);
                if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                    headers = parsed as Record<string, string>;
                }
            } catch {
                showMessage(window.siyuan.languages.aiMcpHeadersInvalid);
                return;
            }
        }
        const nextServer: Config.IMCPServer = {
            ...initialServer,
            name: dialog.element.querySelector<HTMLInputElement>("#aiMcpServerName").value,
            type: dialog.element.querySelector<HTMLSelectElement>("#aiMcpServerType").value,
            command: dialog.element.querySelector<HTMLInputElement>("#aiMcpServerCommand").value,
            args: dialog.element.querySelector<HTMLTextAreaElement>("#aiMcpServerArgs").value.split("\n").map((s) => s.trim()).filter(Boolean),
            url: dialog.element.querySelector<HTMLInputElement>("#aiMcpServerUrl").value,
            headers,
            timeout: dialog.element.querySelector<HTMLInputElement>("#aiMcpServerTimeout").valueAsNumber,
            trustToolAnnotations: dialog.element.querySelector<HTMLInputElement>("#aiMcpTrustToolAnnotations").checked,
        };
        if (!nextServer.name) {
            showMessage(window.siyuan.languages.aiMcpServerNameRequired);
            return;
        }
        if (window.siyuan.config.ai.mcp.servers.some((server) => {
            return server.name === nextServer.name && server.name !== serverName;
        })) {
            showMessage(window.siyuan.languages.aiMcpServerNameDuplicate);
            return;
        }
        const servers = window.siyuan.config.ai.mcp.servers;
        const nextServers = isNew
            ? [...servers, nextServer]
            : servers.map((item) => item.name !== serverName ? item : nextServer);
        saveMcpServers(root, nextServers);
        dialog.destroy();
    });
};

const syncMcpTypeFields = (dialogEl: HTMLElement, type: string) => {
    dialogEl.querySelectorAll<HTMLElement>("[data-mcp-type]").forEach((label) => {
        label.classList.toggle("fn__none", label.dataset.mcpType !== type);
    });
};

const findMcpServer = (serverName: string) =>
    window.siyuan.config.ai.mcp.servers.find((server) => server.name === serverName);

const saveMcpServers = (root: HTMLElement, servers: Config.IMCPServer[]) => {
    aiConfigApi.patch("mcp.servers", servers, () => renderMcpServerList(root));
};
