import {Dialog} from "../../../dialog";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {showMessage} from "../../../dialog/message";
import {Constants} from "../../../constants";
import {isMobile} from "../../../util/functions";
import {fetchPost} from "../../../util/fetch";
import {escapeHtml} from "../../../util/escape";
import {aiConfigApi} from "./aiRuntime";
import {openByMobile} from "../../../editor/openLink";
/// #if !BROWSER
import {shell} from "electron";
/// #endif

type ModelPickerGroup = "editing" | "agent" | "imageGeneration";

export const getProvidersBlockKeywords = (): string[] => [
    window.siyuan.languages.apiKeyRequired,
    window.siyuan.languages.apiProvider,
    window.siyuan.languages.openAICompatibleProvider,
    window.siyuan.languages.apiProviderTip,
    window.siyuan.languages.aiProviderOfficial,
    window.siyuan.languages.aiProviderAggregator,
    window.siyuan.languages.aiProviderLocal,
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
                total: number,
                indexed: number,
                pending: number,
                failed: number,
                ignoredByLen: number,
                ignoredByConfig: number,
                enabled: boolean,
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

const mountModelTestButton = (root: HTMLElement, inputId: string, buttonId: string) => {
    const inputElement = root.querySelector<HTMLInputElement>(`[id="${inputId}"]`);
    const itemElement = inputElement?.closest<HTMLElement>(".config-item");
    const wrapperElement = itemElement?.querySelector<HTMLElement>(":scope > .fn__block");
    const nameElement = wrapperElement?.querySelector<HTMLElement>(":scope > .config-name");
    const descriptionElement = wrapperElement?.querySelector<HTMLElement>(":scope > .b3-label__text");
    const separatorElement = wrapperElement?.querySelector<HTMLElement>(":scope > .fn__hr--small");
    if (!inputElement || !itemElement || !nameElement || !descriptionElement || !separatorElement) {
        return;
    }

    const headerElement = document.createElement("div");
    headerElement.className = "fn__flex";
    const textElement = document.createElement("div");
    textElement.className = "fn__flex-1";
    textElement.append(nameElement, descriptionElement);
    const spaceElement = document.createElement("div");
    spaceElement.className = "fn__space";
    const buttonElement = document.createElement("div");
    buttonElement.style.textAlign = "right";
    buttonElement.style.marginTop = "8px";
    buttonElement.innerHTML = `<button class="b3-button b3-button--outline" id="${buttonId}"><svg class="b3-button__icon"><use xlink:href="#iconPlugZap"></use></svg><span>${window.siyuan.languages.testConnection}</span></button>`;
    headerElement.append(textElement, spaceElement, buttonElement);
    separatorElement.className = "fn__hr";
    itemElement.replaceChildren(headerElement, separatorElement, inputElement);
    return buttonElement.querySelector<HTMLButtonElement>(`#${buttonId}`);
};

// mountEmbeddingTestBtn 将测试按钮放在嵌入模型说明右侧，并绑定连接测试事件。
// 嵌入配置即时保存，点测试时内核已持最新配置，故无需前端传参。
export const mountEmbeddingTestBtn = (root: HTMLElement) => {
    const testBtn = mountModelTestButton(root, "ai.embedding.name", "aiEmbeddingTestBtn");
    if (!testBtn) {
        return;
    }
    const iconUse = testBtn.querySelector("use");
    const svgEl = testBtn.querySelector("svg");
    const labelSpan = testBtn.querySelector("span");
    if (!iconUse || !svgEl || !labelSpan) {
        return;
    }
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
                    ? window.siyuan.languages.testConnectionFailMsg.replace("${msg}", escapeHtml(String(data.msg)))
                    : window.siyuan.languages.testConnectionFail,
                undefined, "error",
            );
        });
    });
};

// mountRerankTestBtn 将测试按钮放在重排模型说明右侧，并绑定连接测试事件。
// 重排配置即时保存，点测试时内核已持最新配置，故无需前端传参。
export const mountRerankTestBtn = (root: HTMLElement) => {
    const testBtn = mountModelTestButton(root, "ai.rerank.name", "aiRerankTestBtn");
    if (!testBtn) {
        return;
    }
    const iconUse = testBtn.querySelector("use");
    const svgEl = testBtn.querySelector("svg");
    const labelSpan = testBtn.querySelector("span");
    if (!iconUse || !svgEl || !labelSpan) {
        return;
    }
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
                    ? window.siyuan.languages.testConnectionFailMsg.replace("${msg}", escapeHtml(String(data.msg)))
                    : window.siyuan.languages.testConnectionFail,
                undefined, "error",
            );
        });
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
    } else {
        keywords.push(window.siyuan.languages.aiImageGeneration, window.siyuan.languages.aiImageGenerationTip);
    }
    return keywords;
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
    <div class="fn__flex config-wrap">
        <span class="b3-label__text">${window.siyuan.languages.aiMcpServersTip}</span>
        <span class="fn__flex-1"></span>
        <span id="aiMcpStatusSummary" class="b3-label__text ft__on-surface fn__none"></span>
    </div>
    <div class="fn__hr--small"></div>
    <div id="aiMcpServerList"></div>
</div>`;

const mountAddMcpServerButton = (root: HTMLElement, block: HTMLElement) => {
    const groupTitle = block.closest<HTMLElement>(".config-group")
        ?.querySelector<HTMLElement>(":scope > .config-title");
    if (!groupTitle || groupTitle.querySelector("[data-type='addAiMcpServer']")) {
        return;
    }

    groupTitle.classList.add("config-title--action");
    groupTitle.insertAdjacentHTML("beforeend", `<span class="fn__flex-1"></span>
<button class="b3-button b3-button--outline fn__flex-center fn__size200" data-type="addAiMcpServer">
    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
    <span>${Lute.EscapeHTMLStr(window.siyuan.languages.addAiMcpServer)}</span>
</button>`);
    (groupTitle.lastElementChild as HTMLButtonElement).addEventListener("click", (event) => {
        openMcpServerDialog(root, null);
        event.preventDefault();
        event.stopPropagation();
    });
};

export const mountMcpServersBlock = (root: HTMLElement) => {
    const block = root.querySelector<HTMLElement>("#aiMcpServersBlock");
    if (!block) {
        return;
    }
    mountAddMcpServerButton(root, block);
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
