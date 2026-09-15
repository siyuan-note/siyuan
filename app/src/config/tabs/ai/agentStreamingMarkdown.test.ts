import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/config/tabs/ai/agentStreamingMarkdown.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const createPreference = (values = new Map<string, string>(), unavailable = false) => {
    const events: {type: string}[] = [];
    const exports = {} as typeof import("./agentStreamingMarkdown");
    runInNewContext(compiled, {
        exports,
        CustomEvent: class {
            constructor(public type: string) {}
        },
        window: {
            localStorage: {
                getItem: (key: string) => {
                    if (unavailable) {
                        throw new Error("Storage unavailable");
                    }
                    return values.get(key) ?? null;
                },
                setItem: (key: string, value: string) => {
                    if (unavailable) {
                        throw new Error("Storage unavailable");
                    }
                    values.set(key, value);
                },
            },
            dispatchEvent: (event: {type: string}) => events.push(event),
        },
    });
    return {...exports, events, values};
};

test("streaming Markdown requires an explicit device-local opt-in", () => {
    const preference = createPreference();
    assert.equal(preference.isAgentStreamingMarkdownEnabled(), false);
    for (const value of ["", "false", "1", "invalid", "TRUE"]) {
        preference.values.set(preference.AGENT_STREAMING_MARKDOWN_KEY, value);
        assert.equal(preference.isAgentStreamingMarkdownEnabled(), false);
    }
    preference.setAgentStreamingMarkdownEnabled(true);
    assert.equal(preference.isAgentStreamingMarkdownEnabled(), true);
    assert.equal(preference.values.size, 1);
    assert.equal(createPreference(preference.values).isAgentStreamingMarkdownEnabled(), true);
    assert.equal(preference.events[0].type, preference.AGENT_STREAMING_MARKDOWN_CHANGED_EVENT);
    preference.setAgentStreamingMarkdownEnabled(false);
    assert.equal(createPreference(preference.values).isAgentStreamingMarkdownEnabled(), false);
});

test("unavailable storage defaults to off and allows a session-only preference", () => {
    const preference = createPreference(new Map(), true);
    assert.equal(preference.isAgentStreamingMarkdownEnabled(), false);
    preference.setAgentStreamingMarkdownEnabled(true);
    assert.equal(preference.isAgentStreamingMarkdownEnabled(), true);
    preference.setAgentStreamingMarkdownEnabled(false);
    assert.equal(preference.isAgentStreamingMarkdownEnabled(), false);
});

test("reads updates made by other windows instead of caching persisted values", () => {
    const preference = createPreference();
    preference.setAgentStreamingMarkdownEnabled(true);
    preference.values.delete(preference.AGENT_STREAMING_MARKDOWN_KEY);
    assert.equal(preference.isAgentStreamingMarkdownEnabled(), false);
});
