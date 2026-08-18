import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    bindDynamicIconTarget,
    genEmojiImageHTML,
    getIconSearchText,
    getIconValueKind,
    getNetworkIconName,
    normalizeNetworkIconURL,
    normalizeRecentIconValue,
    parseBase64Image,
    updateRecentIconValues,
} from "./iconValue";

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

describe("getNetworkIconName", () => {
    it("uses the decoded URL path name and preserves image extensions", () => {
        assert.equal(getNetworkIconName("https://example.com/images/%E5%A4%B4%E5%83%8F.png?size=64"), "头像.png");
        assert.equal(getNetworkIconName("https://example.com/images/icon.php"), "icon");
        assert.equal(getNetworkIconName("https://example.com/images/foo%2Fbar.webp"), "foo_bar.webp");
        assert.equal(getNetworkIconName("https://example.com/images/.png"), "icon.png");
    });

    it("falls back when the URL has no usable path name", () => {
        assert.equal(getNetworkIconName("https://example.com/"), "icon");
        assert.equal(getNetworkIconName("invalid"), "icon");
    });
});

describe("getIconValueKind", () => {
    it("distinguishes supported icon value formats", () => {
        assert.equal(getIconValueKind("1f600"), "unicode");
        assert.equal(getIconValueKind("folder/icon.png"), "custom");
        assert.equal(getIconValueKind("api/icon/getDynamicIcon?type=8&content=A.B"), "dynamic");
        assert.equal(getIconValueKind("https://example.com/icon.png"), "network");
        assert.equal(getIconValueKind("javascript:alert(1)"), "invalid");
    });
});

describe("parseBase64Image", () => {
    it("decodes supported image data URLs", () => {
        const parsed = parseBase64Image(" data:image/png;base64,AQID ");
        assert.ok(parsed);
        assert.equal(parsed.mimeType, "image/png");
        assert.equal(parsed.extension, "png");
        assert.deepEqual([...parsed.bytes], [1, 2, 3]);

        const svg = parseBase64Image("data:image/svg+xml;charset=utf-8;base64,PHN2Zz48L3N2Zz4=");
        assert.ok(svg);
        assert.equal(svg.extension, "svg");
    });

    it("rejects unsupported, empty, and malformed data URLs", () => {
        [
            "",
            "data:text/plain;base64,AQID",
            "data:image/bmp;base64,AQID",
            "data:image/png,AQID",
            "data:image/png;base64,",
            "data:image/png;base64,***",
        ].forEach(item => assert.equal(parseBase64Image(item), undefined));
    });
});

describe("dynamic icon recent values", () => {
    it("removes source IDs and canonicalizes query parameters", () => {
        assert.equal(
            normalizeRecentIconValue("api/icon/getDynamicIcon?type=8&content=%E6%97%A5&id=source&color=%23d23f31"),
            "api/icon/getDynamicIcon?color=%23d23f31&content=%E6%97%A5&type=8",
        );
    });

    it("binds text dynamic icons to the current target", () => {
        const recent = "api/icon/getDynamicIcon?content=%E6%97%A5&type=8";
        assert.equal(
            bindDynamicIconTarget(recent, "current"),
            "api/icon/getDynamicIcon?content=%E6%97%A5&id=current&type=8",
        );
        assert.equal(
            bindDynamicIconTarget("api/icon/getDynamicIcon?date=&type=1", "current"),
            "api/icon/getDynamicIcon?date=&type=1",
        );
    });

    it("provides custom text for recent icon search", () => {
        assert.match(getIconSearchText("api/icon/getDynamicIcon?content=%E6%97%A5&type=8"), /^日 /);
    });
});

describe("updateRecentIconValues", () => {
    it("moves normalized values to the front without shrinking the list", () => {
        const values = Array.from({length: 64}, (_, index) => index === 20 ?
            "api/icon/getDynamicIcon?type=8&content=%E6%97%A5&id=source" :
            `1f${index.toString(16).padStart(3, "0")}`);
        const updated = updateRecentIconValues(
            values,
            "api/icon/getDynamicIcon?content=%E6%97%A5&id=current&type=8",
            64,
        );
        assert.equal(updated.length, 64);
        assert.equal(updated[0], "api/icon/getDynamicIcon?content=%E6%97%A5&type=8");
        assert.equal(updated.filter(item => item.includes("content=%E6%97%A5")).length, 1);
    });

    it("ignores unsupported icon values", () => {
        assert.deepEqual(updateRecentIconValues(["1f600"], "javascript:alert(1)", 64), ["1f600"]);
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

    it("does not double-escape persisted image icon URLs", () => {
        assert.equal(
            genEmojiImageHTML("api/icon/getDynamicIcon?type=1&amp;color=%23d23f31", "icon"),
            '<img class="icon" src="api/icon/getDynamicIcon?type=1&amp;color=%23d23f31"/>',
        );
        assert.equal(
            genEmojiImageHTML("https://example.com/icon?id=1&amp;size=2", "icon"),
            '<img class="icon" src="https://example.com/icon?id=1&amp;size=2" referrerpolicy="no-referrer"/>',
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
