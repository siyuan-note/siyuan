import * as assert from "node:assert/strict";
import {test} from "node:test";
import {loadModule} from "../../../testSupport/loadModule";
import {createSectionRuntime} from "../../util/sectionRuntime";

test("streaming Markdown uses confirmed AI preferences and preserves readonly protection", async () => {
    const siyuan = {config: {ai: {agent: {streamingMarkdown: false}}, readonly: false}, isPublish: false,
        storage: {"siyuan-agent-streaming-markdown": true}};
    const saved: unknown[][] = [];
    const exports = loadModule<typeof import("./agentStreamingMarkdown")>("src/config/tabs/ai/agentStreamingMarkdown.ts", {
        window: {siyuan}, require: () => ({aiConfigApi: {
            patch: async (...args: unknown[]) => {saved.push(args);},
        }})});
    assert.equal(exports.isAgentStreamingMarkdownEnabled(), false);
    await exports.setAgentStreamingMarkdownEnabled(true);
    assert.deepEqual(saved, [["agent.streamingMarkdown", true]]);
    assert.equal(exports.isAgentStreamingMarkdownEnabled(), false);
    siyuan.config.ai.agent.streamingMarkdown = true;
    assert.equal(exports.isAgentStreamingMarkdownEnabled(), true);
    siyuan.config.readonly = true;
    await exports.setAgentStreamingMarkdownEnabled(false);
    siyuan.config.readonly = false;
    siyuan.isPublish = true;
    await exports.setAgentStreamingMarkdownEnabled(false);
    assert.equal(saved.length, 1);
});

test("confirmed AI updates notify streaming renderers once per changed preference", async () => {
    const config = {ai: {agent: {streamingMarkdown: false}}};
    const events: string[] = [];
    const exports = loadModule<typeof import("./aiRuntime")>("src/config/tabs/ai/aiRuntime.ts", {
        window: {siyuan: {config}, dispatchEvent: (event: Event) => events.push(event.type)},
        CustomEvent: class { constructor(public type: string) {} },
        require: () => ({
            AGENT_STREAMING_MARKDOWN_CHANGED_EVENT: "siyuan-agent-streaming-markdown-changed",
            createConfigNamespaceApi: (options: {namespace: string; getConfig: () => typeof config.ai;
                setConfig: (data: typeof config.ai) => void;
                reactions: Parameters<typeof createSectionRuntime<typeof config.ai>>[0]["reactions"]}) =>
                createSectionRuntime({namespace: options.namespace, get: options.getConfig, set: options.setConfig,
                    reactions: options.reactions}),
        }),
    });
    await exports.aiConfigApi.apply({agent: {streamingMarkdown: true}} as Config.IAI);
    await exports.aiConfigApi.apply({agent: {streamingMarkdown: true}} as Config.IAI);
    await exports.aiConfigApi.apply({agent: {streamingMarkdown: false}} as Config.IAI);
    assert.equal(events.filter(name => name === "siyuan-agent-streaming-markdown-changed").length, 2);
    assert.equal(config.ai.agent.streamingMarkdown, false);
});
