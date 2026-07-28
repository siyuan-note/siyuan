import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {genEmojiImageHTML, normalizeNetworkIconURL} from "./iconValue";

describe("normalizeNetworkIconURL", () => {
    it("accepts absolute HTTP(S) links without relying on file extensions", () => {
        assert.equal(normalizeNetworkIconURL(" https://example.com/icon?id=1#preview "), "https://example.com/icon?id=1#preview");
        assert.equal(normalizeNetworkIconURL("http://127.0.0.1:8080/icon"), "http://127.0.0.1:8080/icon");
        assert.equal(normalizeNetworkIconURL("HTTPS://example.com/icon path"), "https://example.com/icon%20path");
    });

    it("rejects non-HTTP(S), relative, and malformed links", () => {
        [
            "",
            "icon.png",
            "//example.com/icon.png",
            "data:image/png;base64,AAAA",
            "file:///tmp/icon.png",
            "ftp://example.com/icon.png",
            "javascript:alert(1)",
            "https://",
        ].forEach(item => assert.equal(normalizeNetworkIconURL(item), undefined));
    });
});

describe("genEmojiImageHTML", () => {
    it("renders network, dynamic, and custom image icons", () => {
        assert.equal(
            genEmojiImageHTML("https://example.com/icon?id=1&size=2", "icon", true),
            '<img class="icon" data-src="https://example.com/icon?id=1&amp;size=2" referrerpolicy="no-referrer"/>',
        );
        assert.equal(
            genEmojiImageHTML("api/icon/getDynamicIcon?type=1", "icon"),
            '<img class="icon" src="api/icon/getDynamicIcon?type=1"/>',
        );
        assert.equal(
            genEmojiImageHTML("folder/icon.png"),
            '<img class="" src="/emojis/folder/icon.png"/>',
        );
    });

    it("does not treat unsupported URL schemes or Emoji codepoints as image sources", () => {
        assert.equal(genEmojiImageHTML("data:image/png;base64,AAAA"), undefined);
        assert.equal(genEmojiImageHTML("file:///tmp/icon.png"), undefined);
        assert.equal(genEmojiImageHTML("1f600"), undefined);
    });

    it("escapes attribute-breaking network URL content", () => {
        const html = genEmojiImageHTML('https://example.com/&quot;" onerror="alert(1).png', '" onerror="alert(2)');
        assert.ok(html);
        assert.equal((html.match(/\ssrc=/g) || []).length, 1);
        assert.equal((html.match(/\sonerror="/g) || []).length, 0);
        assert.match(html, /&amp;quot;%22/);
    });
});
