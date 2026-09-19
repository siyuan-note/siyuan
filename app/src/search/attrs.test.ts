import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getAttr} from "./attrs";

const payload = "<img src=x onerror=alert(1)>";

describe("getAttr", () => {
    it("escapes raw HTML in name, alias and memo", () => {
        const html = getAttr({name: payload, alias: payload, memo: payload});
        assert.equal(html.includes("<img"), false);
        // escapeSearchHighlight 只转义 <，裸 > 在文本上下文中无害
        assert.equal(html.match(/&lt;img src=x onerror=alert\(1\)>/g)?.length, 3);
    });

    it("preserves the search highlight inserted by the kernel", () => {
        const html = getAttr({name: "", alias: "&lt;b&gt;<mark>xw</mark>", memo: ""});
        assert.equal(html.includes("<mark>xw</mark>"), true);
        assert.equal(html.includes("&lt;b&gt;"), true);
    });

    it("does not escape the text already escaped by the kernel twice", () => {
        const html = getAttr({name: "a&amp;b", alias: "", memo: ""});
        assert.equal(html.includes("a&amp;b"), true);
        assert.equal(html.includes("&amp;amp;"), false);
    });

    it("omits empty attributes", () => {
        assert.equal(getAttr({name: "", alias: "", memo: ""}), "");
    });
});
