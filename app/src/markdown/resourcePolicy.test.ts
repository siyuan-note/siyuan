import {test} from "node:test";
import * as assert from "node:assert/strict";
import {isMarkdownDisplayResource, remoteMarkdownImageURL} from "./resourcePolicy";

test("remote image URLs accept HTTP images without granting access to native resources or other schemes", () => {
    for (const reference of ["https://img.shields.io/pypi/v/example.svg?label=release", "http://example.com/photo.png", "https://example.com/a.png#part"]) {
        assert.equal(remoteMarkdownImageURL(reference), reference);
    }
    assert.equal(remoteMarkdownImageURL("//example.com/badge.svg"), "https://example.com/badge.svg");
    for (const reference of ["assets/a.png", "file:///private.png", "data:image/svg+xml,test", "javascript:alert(1)",
        "https://user:password@example.com/a.png", "https://siyuan-markdown.local/resource/other/token", "http://siyuan-markdown.local/index.html", "https://example.com/a\n.png"]) {
        assert.equal(remoteMarkdownImageURL(reference), undefined, reference);
    }
});

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
