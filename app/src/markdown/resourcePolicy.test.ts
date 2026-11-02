import {test} from "node:test";
import * as assert from "node:assert/strict";
import {isMarkdownDisplayResource} from "./resourcePolicy";

test("custom-scheme images belong to the current session origin and exact resource path", () => {
    const page = "siyuan-markdown://session-a/index.html";
    assert.equal(isMarkdownDisplayResource("siyuan-markdown://session-a/resource/token", page), true);
    for (const resource of ["siyuan-markdown://session-b/resource/token", "siyuan-markdown://session-a/resource/token/extra",
        "siyuan-markdown://session-a/resource/token?path=secret", "https://session-a/resource/token"]) {
        assert.equal(isMarkdownDisplayResource(resource, page), false);
    }
});

test("mobile HTTPS images require the fixed native origin and the current session identity", () => {
    const page = "https://siyuan-markdown.local/stage/build/markdown/index.html";
    assert.equal(isMarkdownDisplayResource("https://siyuan-markdown.local/resource/session-a/token", page, "session-a"), true);
    for (const resource of ["https://siyuan-markdown.local/resource/session-b/token", "https://siyuan-markdown.local/resource/session-a/../secret",
        "https://siyuan-markdown.local:8080/resource/session-a/token", "https://user@siyuan-markdown.local/resource/session-a/token",
        "https://example.com/resource/session-a/token", "https://siyuan-markdown.local/resource/session-a/token#fragment"]) {
        assert.equal(isMarkdownDisplayResource(resource, page, "session-a"), false);
    }
    assert.equal(isMarkdownDisplayResource("https://siyuan-markdown.local/resource/session-a/token", page), false);
    assert.equal(isMarkdownDisplayResource("https://example.com/resource/session-a/token", "https://example.com/index.html", "session-a"), false);
});
