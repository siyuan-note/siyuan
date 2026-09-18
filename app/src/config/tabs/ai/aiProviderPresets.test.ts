import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    findProviderPreset,
    getDefaultProviderProtocol,
    getProviderProtocolBaseURL,
    getResponsesSupport,
    PROVIDER_PRESETS,
} from "./aiProviderPresets";

describe("AI provider presets", () => {
    it("uses the current MiniMax China endpoint for newly created providers", () => {
        const preset = PROVIDER_PRESETS.find((item) => item.id === "minimax-cn");
        assert.equal(preset?.baseURL, "https://api.minimax.cn/v1");
        assert.equal(findProviderPreset("https://api.minimax.cn/v1/")?.id, "minimax-cn");
        assert.equal(findProviderPreset("https://api.minimaxi.com/v1"), undefined);
    });

    it("defaults only the OpenAI preset to Responses", () => {
        assert.equal(getDefaultProviderProtocol("openai"), "openai-responses");
        assert.equal(getDefaultProviderProtocol("deepseek"), "openai");
        assert.equal(getDefaultProviderProtocol("custom"), "openai");
    });

    it("selects Messages for the Anthropic preset without changing custom provider defaults", () => {
        assert.equal(getDefaultProviderProtocol("anthropic"), "anthropic-messages");
        assert.equal(findProviderPreset("https://api.anthropic.com/v1/")?.id, "anthropic");
        assert.equal(getResponsesSupport("https://api.anthropic.com/v1"), "unsupported");
        assert.equal(getDefaultProviderProtocol("custom"), "openai");
        assert.equal(getDefaultProviderProtocol("openai"), "openai-responses");
    });

    it("reports known and custom Responses compatibility", () => {
        assert.equal(getResponsesSupport("https://api.deepseek.com"), "supported");
        assert.equal(getResponsesSupport("https://open.bigmodel.cn/api/paas/v4"), "unsupported");
        assert.equal(getResponsesSupport("https://example.com/v1"), "experimental");
    });

    it("switches DeepSeek standard endpoints with the selected protocol", () => {
        for (const baseURL of [
            "https://api.deepseek.com", "https://api.deepseek.com/v1/",
            "https://api.deepseek.com/anthropic", "https://api.deepseek.com/anthropic/v1/",
        ]) {
            assert.equal(findProviderPreset(baseURL)?.id, "deepseek");
            assert.equal(getProviderProtocolBaseURL(baseURL, "anthropic-messages"), "https://api.deepseek.com/anthropic");
            assert.equal(getProviderProtocolBaseURL(baseURL, "openai"), "https://api.deepseek.com");
            assert.equal(getProviderProtocolBaseURL(baseURL, "openai-responses"), "https://api.deepseek.com");
            assert.equal(getProviderProtocolBaseURL(baseURL, "unknown"), baseURL);
        }
    });

    it("round-trips provider protocols without changing regions", () => {
        for (const [id, openai, anthropic] of [
            ["moonshot", "https://api.moonshot.cn/v1", "https://api.moonshot.cn/anthropic"],
            ["minimax", "https://api.minimax.io/v1", "https://api.minimax.io/anthropic"],
            ["minimax-cn", "https://api.minimax.cn/v1", "https://api.minimax.cn/anthropic"],
            ["aliyun", "https://dashscope.aliyuncs.com/compatible-mode/v1", "https://dashscope.aliyuncs.com/apps/anthropic"],
            ["aliyun-intl", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "https://dashscope-intl.aliyuncs.com/apps/anthropic"],
        ]) {
            assert.equal(getProviderProtocolBaseURL(openai, "anthropic-messages"), anthropic);
            for (const baseURL of [anthropic, anthropic + "/v1/"]) {
                assert.equal(findProviderPreset(baseURL)?.id, id);
                assert.equal(getProviderProtocolBaseURL(baseURL, "openai"), openai);
                assert.equal(getProviderProtocolBaseURL(baseURL, "openai-responses"), openai);
            }
            for (const baseURL of [anthropic + "?route=custom", anthropic + "/custom"]) {
                assert.equal(getProviderProtocolBaseURL(baseURL, "openai"), baseURL);
            }
        }
    });

    it("preserves custom endpoints and providers without protocol-specific addresses", () => {
        for (const baseURL of [
            "https://gateway.example.com/deepseek/v1", "https://api.deepseek.com/custom",
            "https://api.deepseek.com?route=custom", "https://api.deepseek.com/anthropic?route=custom",
            "https://api.deepseek.com.example.com", "https://api.openai.com/v1",
        ]) {
            assert.equal(getProviderProtocolBaseURL(baseURL, "anthropic-messages"), baseURL);
        }
    });
});
