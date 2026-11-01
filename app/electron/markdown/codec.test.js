const assert = require("node:assert/strict");
const {test} = require("node:test");
const {decodeMarkdown, encodeMarkdown} = require("./codec");

test("Markdown codec rejects invalid UTF-8 and unpaired Unicode surrogates", () => {
    for (const bytes of [[0xc0, 0xaf], [0xe4, 0xb8], [0xed, 0xa0, 0x80], [0xff]]) {
        assert.throws(() => decodeMarkdown(new Uint8Array(bytes)), TypeError);
    }
    for (const content of ["\ud800", "\udc00", "\ud800a", "a\udc00"]) {
        assert.throws(() => encodeMarkdown(content, {bom: false, newline: "\n"}), TypeError);
    }
});

test("Markdown codec preserves BOM and dominant newline with first occurrence breaking ties", () => {
    const bytes = new TextEncoder().encode("\uFEFFfirst\r\nsecond\nthird\r\nlast\r");
    const result = decodeMarkdown(bytes);
    assert.deepEqual(result, {content: "first\nsecond\nthird\nlast\n", format: {bom: true, newline: "\r\n"}});
    assert.equal(new TextDecoder("utf-8", {ignoreBOM: true}).decode(encodeMarkdown(result.content, result.format)),
        "\uFEFFfirst\r\nsecond\r\nthird\r\nlast\r\n");
    assert.equal(decodeMarkdown(new TextEncoder().encode("a\rb\nc\r\n")).format.newline, "\r");
    assert.deepEqual(decodeMarkdown(new TextEncoder().encode("😀")), {content: "😀", format: {bom: false, newline: "\n"}});
    assert.equal(new TextDecoder().decode(encodeMarkdown("😀", {bom: false, newline: "\n"})), "😀");
});
