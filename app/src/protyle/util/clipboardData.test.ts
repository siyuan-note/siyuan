import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {buildWebClipboardHTML, getTextSiyuanFromTextHTML} from "./clipboardData";

describe("clipboard HTML data", () => {
    it("keeps native HTML clean and round-trips SiYuan data through web HTML", () => {
        const textHTML = "<p>正文</p>";
        const textSiyuan = '<div data-type="NodeParagraph">正文</div>';
        const webHTML = buildWebClipboardHTML(textHTML, textSiyuan);

        assert.match(webHTML, /^<!--data-siyuan='[^']+'--><p>正文<\/p>$/);
        assert.deepEqual(getTextSiyuanFromTextHTML(webHTML), {
            textSiyuan,
            textHtml: textHTML,
        });
    });

    it("does not modify HTML without SiYuan data", () => {
        const textHTML = "<p>Plain HTML</p>";

        assert.equal(buildWebClipboardHTML(textHTML, ""), textHTML);
    });
});
