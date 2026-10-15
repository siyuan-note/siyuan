import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {parseClaudeCodeEnv, stringifyClaudeCodeEnv} from "./aiProviderEnv";

describe("AI provider command line environment", () => {
    it("treats empty input as no environment variables", () => {
        assert.deepEqual(parseClaudeCodeEnv(""), {});
        assert.deepEqual(parseClaudeCodeEnv("   "), {});
    });

    it("keeps environment variable references in values", () => {
        assert.deepEqual(
            parseClaudeCodeEnv('{"ANTHROPIC_BASE_URL":"https://api.deepseek.com/anthropic","ANTHROPIC_AUTH_TOKEN":"${MY_TOKEN}"}'),
            {ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic", ANTHROPIC_AUTH_TOKEN: "${MY_TOKEN}"},
        );
    });

    it("rejects invalid names, non-string values, empty values and non-objects", () => {
        assert.equal(parseClaudeCodeEnv('{"MY-TOKEN":"x"}'), null);
        assert.equal(parseClaudeCodeEnv('{"1TOKEN":"x"}'), null);
        assert.equal(parseClaudeCodeEnv('{"ANTHROPIC_AUTH_TOKEN":1}'), null);
        assert.equal(parseClaudeCodeEnv('{"ANTHROPIC_AUTH_TOKEN":"  "}'), null);
        assert.equal(parseClaudeCodeEnv('{"ANTHROPIC_AUTH_TOKEN":"a\\nb"}'), null);
        assert.equal(parseClaudeCodeEnv("[]"), null);
        assert.equal(parseClaudeCodeEnv('"text"'), null);
        assert.equal(parseClaudeCodeEnv("{invalid}"), null);
    });

    it("serializes only non-empty configuration", () => {
        assert.equal(stringifyClaudeCodeEnv(undefined), "");
        assert.equal(stringifyClaudeCodeEnv({}), "");
        assert.equal(stringifyClaudeCodeEnv({ANTHROPIC_MODEL: "sonnet"}), '{\n  "ANTHROPIC_MODEL": "sonnet"\n}');
    });
});
