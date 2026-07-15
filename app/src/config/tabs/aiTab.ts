import type {SettingTabBuilder} from "../setting/builder";
import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {fetchPost} from "../../util/fetch";
import {
    genProvidersBlockHtml,
    getProvidersBlockKeywords,
    mountProvidersBlock,
    genModelPickerHtml,
    getModelPickerKeywords,
    mountModelPickerBlock,
    genMcpServersBlockHtml,
    getMcpServersBlockKeywords,
    mountMcpServersBlock,
    genEmbeddingStatsHtml,
    getEmbeddingStatsKeywords,
    mountEmbeddingStatsBlock,
    mountEmbeddingTestBtn,
    mountRerankTestBtn,
} from "./aiUi";

const registerAiProvidersGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("providers", window.siyuan.languages.apiProvider);

    group.slot({
        key: "providers",
        keywords: getProvidersBlockKeywords(),
        html: genProvidersBlockHtml,
        afterMount: mountProvidersBlock,
    });
};

const registerAiEditingGroup = (tab: SettingTabBuilder) => {
    const groupId = "editing";
    const group = tab.group(groupId, window.siyuan.languages.editor);

    group.slot({
        key: "editingModelPicker",
        keywords: getModelPickerKeywords(groupId),
        html: () => genModelPickerHtml(groupId),
        afterMount: (root) => mountModelPickerBlock(root, groupId),
    });
    group.number("ai.editing.maxCompletionTokens", {
        title: window.siyuan.languages.apiMaxTokens,
        desc: window.siyuan.languages.apiMaxTokensTip,
        min: 0,
    });
    group.number("ai.editing.maxHistoryMessages", {
        title: window.siyuan.languages.apiMaxContexts,
        desc: window.siyuan.languages.apiMaxContextsTip,
        min: 1,
        max: 64,
    });
    group.number("ai.editing.temperature", {
        title: window.siyuan.languages.apiTemperature,
        desc: window.siyuan.languages.apiTemperatureTip,
        min: 0,
        max: 2,
        step: "0.1",
    });
};

const registerAiAgentGroup = (tab: SettingTabBuilder) => {
    const groupId = "agent";
    const group = tab.group(groupId, window.siyuan.languages.agentChat);

    group.slot({
        key: "agentModelPicker",
        keywords: getModelPickerKeywords(groupId),
        html: () => genModelPickerHtml(groupId),
        afterMount: (root) => mountModelPickerBlock(root, groupId),
    });
    group.number("ai.agent.maxCompletionTokens", {
        title: window.siyuan.languages.apiMaxTokens,
        desc: window.siyuan.languages.apiMaxTokensTip,
        min: 0,
    });
    group.number("ai.agent.maxToolCallRounds", {
        title: window.siyuan.languages.agentMaxToolCallRounds,
        desc: window.siyuan.languages.agentMaxToolCallRoundsTip,
        min: 0,
    });
    group.number("ai.agent.temperature", {
        title: window.siyuan.languages.apiTemperature,
        desc: window.siyuan.languages.apiTemperatureTip,
        min: 0,
        max: 2,
        step: "0.1",
    });
    group.number("ai.agent.sessionTimeout", {
        title: window.siyuan.languages.agentTimeout,
        desc: window.siyuan.languages.agentTimeoutTip,
        min: 0,
        max: 3600,
        unit: "s",
    });
    group.number("ai.agent.streamIdleTimeout", {
        title: window.siyuan.languages.agentStreamIdleTimeout,
        desc: window.siyuan.languages.agentStreamIdleTimeoutTip,
        min: 1,
        max: 600,
        unit: "s",
    });
    group.number("ai.agent.confirmTimeout", {
        title: window.siyuan.languages.agentConfirmTimeout,
        desc: window.siyuan.languages.agentConfirmTimeoutTip,
        min: 0,
        unit: "s",
    });
    group.number("ai.agent.maxRetries", {
        title: window.siyuan.languages.agentMaxRetries,
        desc: window.siyuan.languages.agentMaxRetriesTip,
        min: 0,
        max: 10,
    });
};

const registerAiVisionGroup = (tab: SettingTabBuilder) => {
    const groupId = "vision";
    const group = tab.group(groupId, window.siyuan.languages.aiImageUnderstanding);

    group.slot({
        key: "visionModelPicker",
        keywords: getModelPickerKeywords(groupId),
        html: () => genModelPickerHtml(groupId),
        afterMount: (root) => mountModelPickerBlock(root, groupId),
    });
    group.number("ai.vision.requestTimeout", {
        title: window.siyuan.languages.apiTimeout,
        desc: window.siyuan.languages.apiTimeoutTip,
        min: 1,
        max: 600,
        unit: "s",
    });
};

const registerAiImageGenerationGroup = (tab: SettingTabBuilder) => {
    const groupId = "imageGeneration";
    const group = tab.group(groupId, window.siyuan.languages.aiImageGeneration);

    group.slot({
        key: "imageGenerationModelPicker",
        keywords: getModelPickerKeywords(groupId),
        html: () => genModelPickerHtml(groupId),
        afterMount: (root) => mountModelPickerBlock(root, groupId),
    });
    group.number("ai.imageGeneration.requestTimeout", {
        title: window.siyuan.languages.apiTimeout,
        desc: window.siyuan.languages.apiTimeoutTip,
        min: 1,
        max: 600,
        unit: "s",
    });
};

const registerAiMcpGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("mcp", window.siyuan.languages.configGroupMcp);

    group.slot({
        key: "mcpServers",
        keywords: getMcpServersBlockKeywords(),
        html: genMcpServersBlockHtml,
        afterMount: mountMcpServersBlock,
    });
};

const registerAiEmbeddingGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("embedding", window.siyuan.languages.configGroupEmbedding);

    group.switch("ai.embedding.enabled", {
        title: window.siyuan.languages.semanticSearch,
        desc: window.siyuan.languages.semanticSearchTip,
    });
    group.textBlock("ai.embedding.baseURL", {
        title: window.siyuan.languages.apiBaseURL,
        desc: window.siyuan.languages.apiBaseURLEmbeddingTip,
        mode: "input-text",
    });
    group.textBlock("ai.embedding.apiKey", {
        title: window.siyuan.languages.apiKey,
        desc: window.siyuan.languages.apiKeyTip,
        mode: "input-password",
    });
    group.textBlock("ai.embedding.name", {
        title: window.siyuan.languages.apiModel,
        desc: window.siyuan.languages.apiModelTip,
        mode: "input-text",
        afterMount: mountEmbeddingTestBtn,
    });
    group.number("ai.embedding.dimensions", {
        title: window.siyuan.languages.apiDimensions,
        desc: window.siyuan.languages.apiDimensionsTip,
        min: 0,
    });
    group.number("ai.embedding.timeout", {
        title: window.siyuan.languages.apiTimeout,
        desc: window.siyuan.languages.apiTimeoutTip,
        min: 1,
        unit: "s",
    });

    // 独立的嵌入索引重建按钮，不与全局重建索引耦合
    group.button({
        id: "rebuildEmbeddingIndex",
        title: window.siyuan.languages.rebuildEmbeddingIndex,
        desc: window.siyuan.languages.rebuildEmbeddingIndexTip,
        label: window.siyuan.languages.rebuildEmbeddingIndex,
        icon: "iconRefresh",
        afterMount: (root) => {
            root.querySelector("#rebuildEmbeddingIndex")?.addEventListener("click", () => {
                confirmDialog(window.siyuan.languages.rebuildEmbeddingIndex,
                    window.siyuan.languages.rebuildEmbeddingIndexConfirmTip, () => {
                    fetchPost("/api/ai/reindexEmbedding", {}, () => {
                        showMessage(window.siyuan.languages.rebuildEmbeddingIndexStarted);
                    });
                });
            });
        },
    });

    // 嵌入索引进度条 + 统计数字（只读展示，slot 注入）
    group.slot({
        key: "embeddingStats",
        keywords: getEmbeddingStatsKeywords(),
        html: genEmbeddingStatsHtml,
        afterMount: mountEmbeddingStatsBlock,
    });
};

const registerAiRerankGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("rerank", window.siyuan.languages.configGroupRerank);

    group.switch("ai.rerank.enabled", {
        title: window.siyuan.languages.rerankModel,
        desc: window.siyuan.languages.rerankTip,
    });
    group.textBlock("ai.rerank.endpoint", {
        title: window.siyuan.languages.apiEndpoint,
        desc: window.siyuan.languages.apiEndpointRerankTip,
        mode: "input-text",
    });
    group.textBlock("ai.rerank.apiKey", {
        title: window.siyuan.languages.apiKey,
        desc: window.siyuan.languages.apiKeyTip,
        mode: "input-password",
    });
    group.textBlock("ai.rerank.name", {
        title: window.siyuan.languages.apiModel,
        desc: window.siyuan.languages.apiModelTip,
        mode: "input-text",
        afterMount: mountRerankTestBtn,
    });
    group.number("ai.rerank.candidateCount", {
        title: window.siyuan.languages.rerankCandidateCount,
        desc: window.siyuan.languages.rerankCandidateCountTip,
        min: 5,
        max: 100,
    });
    group.number("ai.rerank.timeout", {
        title: window.siyuan.languages.apiTimeout,
        desc: window.siyuan.languages.apiTimeoutTip,
        min: 1,
        unit: "s",
    });
};

export const registerAiTab = (tab: SettingTabBuilder) => {
    registerAiProvidersGroup(tab);
    registerAiEditingGroup(tab);
    registerAiAgentGroup(tab);
    registerAiVisionGroup(tab);
    registerAiImageGenerationGroup(tab);
    registerAiMcpGroup(tab);
    // TODO: add skills group?
    registerAiEmbeddingGroup(tab);
    registerAiRerankGroup(tab);
};
