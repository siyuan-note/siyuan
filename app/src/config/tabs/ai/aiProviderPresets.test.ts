import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    findProviderPreset,
    getDefaultProviderProtocol,
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

    it("reports known and custom Responses compatibility", () => {
        assert.equal(getResponsesSupport("https://api.deepseek.com"), "supported");
        assert.equal(getResponsesSupport("https://open.bigmodel.cn/api/paas/v4"), "unsupported");
        assert.equal(getResponsesSupport("https://example.com/v1"), "experimental");
    });

    it("recognizes API Route aggregator preset", () => {
        const preset = PROVIDER_PRESETS.find((item) => item.id === "api-route");
        assert.equal(preset?.baseURL, "https://global.api-route.com/v1");
        assert.equal(preset?.category, "aggregator");
        assert.equal(preset?.responsesSupport, "supported");
        assert.equal(findProviderPreset("https://global.api-route.com/v1/")?.id, "api-route");
        assert.equal(getDefaultProviderProtocol("api-route"), "openai");
        assert.equal(getResponsesSupport("https://global.api-route.com/v1"), "supported");
    });
});
