export type AIProviderCategory = "official" | "aggregator" | "local" | "custom";
export type AIResponsesSupport = "supported" | "experimental" | "unsupported";

export interface IProviderPreset {
    id: string;
    name: string;
    baseURL: string;
    category: AIProviderCategory;
    responsesSupport: AIResponsesSupport;
    region?: "china" | "international";
    icon?: string;
}

export const PROVIDER_PRESETS: IProviderPreset[] = [
    {id: "openai", name: "OpenAI", baseURL: "https://api.openai.com/v1", category: "official", responsesSupport: "supported", icon: "/stage/images/ai-providers/openai.svg"},
    {id: "deepseek", name: "DeepSeek", baseURL: "https://api.deepseek.com", category: "official", responsesSupport: "supported", icon: "/stage/images/ai-providers/deepseek.svg"},
    {id: "moonshot", name: "Moonshot AI", baseURL: "https://api.moonshot.cn/v1", category: "official", responsesSupport: "experimental", icon: "/stage/images/ai-providers/moonshot.svg"},
    {id: "minimax", name: "MiniMax", baseURL: "https://api.minimax.io/v1", category: "official", responsesSupport: "experimental", region: "international", icon: "/stage/images/ai-providers/minimax.svg"},
    {id: "minimax-cn", name: "MiniMax", baseURL: "https://api.minimax.cn/v1", category: "official", responsesSupport: "experimental", region: "china", icon: "/stage/images/ai-providers/minimax.svg"},
    {id: "aliyun", name: "Alibaba Model Studio", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", category: "official", responsesSupport: "supported", region: "china", icon: "/stage/images/ai-providers/aliyun.svg"},
    {id: "aliyun-intl", name: "Alibaba Model Studio", baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", category: "official", responsesSupport: "supported", region: "international", icon: "/stage/images/ai-providers/aliyun.svg"},
    {id: "volcengine", name: "Volcengine Ark", baseURL: "https://ark.cn-beijing.volces.com/api/v3", category: "official", responsesSupport: "experimental", icon: "/stage/images/ai-providers/volcengine.svg"},
    {id: "zhipu", name: "Zhipu AI", baseURL: "https://open.bigmodel.cn/api/paas/v4", category: "official", responsesSupport: "unsupported", icon: "/stage/images/ai-providers/zhipu.svg"},
    {id: "gemini", name: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", category: "official", responsesSupport: "unsupported", icon: "/stage/images/ai-providers/gemini.svg"},
    {id: "mistral", name: "Mistral AI", baseURL: "https://api.mistral.ai/v1", category: "official", responsesSupport: "unsupported", icon: "/stage/images/ai-providers/mistral.svg"},
    {id: "siliconflow", name: "SiliconFlow", baseURL: "https://api.siliconflow.cn/v1", category: "aggregator", responsesSupport: "unsupported", icon: "/stage/images/ai-providers/siliconflow.svg"},
    {id: "openrouter", name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", category: "aggregator", responsesSupport: "supported", icon: "/stage/images/ai-providers/openrouter.svg"},
    {id: "groq", name: "Groq", baseURL: "https://api.groq.com/openai/v1", category: "aggregator", responsesSupport: "experimental"},
    {id: "ollama", name: "Ollama", baseURL: "http://localhost:11434/v1", category: "local", responsesSupport: "supported", icon: "/stage/images/ai-providers/ollama.svg"},
    {id: "lmstudio", name: "LM Studio", baseURL: "http://localhost:1234/v1", category: "local", responsesSupport: "supported", icon: "/stage/images/ai-providers/lmstudio.svg"},
    {id: "custom", name: "", baseURL: "", category: "custom", responsesSupport: "experimental"},
];

export const normalizeProviderBaseURL = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();

export const findProviderPreset = (baseURL: string) =>
    PROVIDER_PRESETS.find((preset) => preset.baseURL &&
        normalizeProviderBaseURL(preset.baseURL) === normalizeProviderBaseURL(baseURL));

export const getResponsesSupport = (baseURL: string): AIResponsesSupport =>
    findProviderPreset(baseURL)?.responsesSupport || "experimental";

export const getDefaultProviderProtocol = (presetId: string) =>
    presetId === "openai" ? "openai-responses" : "openai";
