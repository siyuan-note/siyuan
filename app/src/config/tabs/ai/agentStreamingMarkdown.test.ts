import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/config/tabs/ai/agentStreamingMarkdown.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const createPreference = (values: Record<string, unknown> = {}, readonly = false) => {
    const events: {type: string}[] = [];
    const storage = {...values};
    const exports = {} as typeof import("./agentStreamingMarkdown");
    runInNewContext(compiled, {
        exports,
        require: (id: string) => {
            assert.equal(id, "../../../protyle/util/compatibility");
            return {setStorageVal: (key: string, value: unknown) => {
                if (!readonly) {
                    values[key] = value;
                }
            }};
        },
        CustomEvent: class {
            constructor(public type: string) {}
        },
        window: {
            siyuan: {storage},
            dispatchEvent: (event: {type: string}) => events.push(event),
        },
    });
    return {...exports, events, values, storage};
};

test("streaming Markdown persists an explicit opt-in through SiYuan storage", () => {
    const preference = createPreference();
    assert.equal(preference.isAgentStreamingMarkdownEnabled(), false);
    for (const value of ["", "false", "true", "1", "invalid", "TRUE", false, 1]) {
        preference.storage[preference.AGENT_STREAMING_MARKDOWN_KEY] = value;
        assert.equal(preference.isAgentStreamingMarkdownEnabled(), false);
    }
    preference.setAgentStreamingMarkdownEnabled(true);
    assert.equal(preference.isAgentStreamingMarkdownEnabled(), true);
    assert.equal(Object.keys(preference.values).length, 1);
    assert.equal(createPreference(preference.values).isAgentStreamingMarkdownEnabled(), true);
    assert.equal(preference.events[0].type, preference.AGENT_STREAMING_MARKDOWN_CHANGED_EVENT);
    preference.setAgentStreamingMarkdownEnabled(false);
    assert.equal(createPreference(preference.values).isAgentStreamingMarkdownEnabled(), false);
});

test("readonly mode allows a session-only preference", () => {
    const preference = createPreference({}, true);
    assert.equal(preference.isAgentStreamingMarkdownEnabled(), false);
    preference.setAgentStreamingMarkdownEnabled(true);
    assert.equal(preference.isAgentStreamingMarkdownEnabled(), true);
    assert.equal(createPreference(preference.values).isAgentStreamingMarkdownEnabled(), false);
    preference.setAgentStreamingMarkdownEnabled(false);
    assert.equal(preference.isAgentStreamingMarkdownEnabled(), false);
});

test("reads updates made by other windows instead of caching persisted values", () => {
    const preference = createPreference();
    preference.setAgentStreamingMarkdownEnabled(true);
    delete preference.storage[preference.AGENT_STREAMING_MARKDOWN_KEY];
    assert.equal(preference.isAgentStreamingMarkdownEnabled(), false);
});
