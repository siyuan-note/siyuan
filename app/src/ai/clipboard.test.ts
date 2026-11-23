import * as assert from "node:assert/strict";
import {test} from "node:test";
import {formatAIGeneratedClipboardText} from "./clipboard";

test("AI clipboard text starts with the localized label and preserves the original Markdown", () => {
    const text = "# Heading\n\n```js\n  run();\n";
    assert.equal(formatAIGeneratedClipboardText(text, "AI 生成"), "AI 生成\n\n" + text);
    assert.equal(formatAIGeneratedClipboardText(text, "AI-generated"), "AI-generated\n\n" + text);
});

test("empty AI clipboard content does not become a standalone label", () => {
    assert.equal(formatAIGeneratedClipboardText("", "AI 生成"), "");
    assert.equal(formatAIGeneratedClipboardText(" \n", "AI 生成"), " \n");
});
