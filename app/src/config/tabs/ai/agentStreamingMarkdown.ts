export const AGENT_STREAMING_MARKDOWN_KEY = "siyuan-agent-streaming-markdown";
export const AGENT_STREAMING_MARKDOWN_CHANGED_EVENT = "siyuan-agent-streaming-markdown-changed";

// 渲染性能取决于当前客户端，显示偏好只在本设备保存，不进入模型配置和会话数据。
let sessionPreference: boolean | undefined;

export const isAgentStreamingMarkdownEnabled = (): boolean => {
    if (sessionPreference !== undefined) {
        return sessionPreference;
    }
    try {
        return window.localStorage.getItem(AGENT_STREAMING_MARKDOWN_KEY) === "true";
    } catch (e) {
        return false;
    }
};

export const setAgentStreamingMarkdownEnabled = (enabled: boolean): void => {
    try {
        window.localStorage.setItem(AGENT_STREAMING_MARKDOWN_KEY, String(enabled));
        sessionPreference = undefined;
    } catch (e) {
        // 存储不可用时仍允许本次打开期间切换预览。
        sessionPreference = enabled;
    }
    window.dispatchEvent(new CustomEvent(AGENT_STREAMING_MARKDOWN_CHANGED_EVENT));
};
