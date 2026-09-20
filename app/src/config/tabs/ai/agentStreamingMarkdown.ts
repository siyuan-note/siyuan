import {setStorageVal} from "../../../protyle/util/compatibility";

export const AGENT_STREAMING_MARKDOWN_KEY = "siyuan-agent-streaming-markdown";
export const AGENT_STREAMING_MARKDOWN_CHANGED_EVENT = "siyuan-agent-streaming-markdown-changed";

export const isAgentStreamingMarkdownEnabled = (): boolean => {
    return window.siyuan.storage[AGENT_STREAMING_MARKDOWN_KEY] === true;
};

export const setAgentStreamingMarkdownEnabled = (enabled: boolean): void => {
    window.siyuan.storage[AGENT_STREAMING_MARKDOWN_KEY] = enabled;
    setStorageVal(AGENT_STREAMING_MARKDOWN_KEY, enabled);
    window.dispatchEvent(new CustomEvent(AGENT_STREAMING_MARKDOWN_CHANGED_EVENT));
};
