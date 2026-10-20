import {aiConfigApi} from "./aiRuntime";

export const AGENT_STREAMING_MARKDOWN_CHANGED_EVENT = "siyuan-agent-streaming-markdown-changed";

export const isAgentStreamingMarkdownEnabled = (): boolean => {
    return window.siyuan.config.ai?.agent?.streamingMarkdown === true;
};

export const setAgentStreamingMarkdownEnabled = (enabled: boolean) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) return;
    return aiConfigApi.patch("agent.streamingMarkdown", enabled);
};
