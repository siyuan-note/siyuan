import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    buildWebClipboardHTML,
    getTextSiyuanFromClipboardData,
    getTextSiyuanFromTextHTML,
} from "./clipboardData";

describe("clipboard HTML data", () => {
    it("reads legacy Harmony HTML only when explicitly enabled", () => {
        const textHtml = "<p>剪切实验</p>";
        const textSiyuan = '<div data-type="NodeParagraph">剪切实验</div>';
        const html = textHtml + "__@text/siyuan@__" + textSiyuan;
        assert.deepEqual(getTextSiyuanFromTextHTML(html, true), {textHtml, textSiyuan});
        assert.deepEqual(getTextSiyuanFromTextHTML(html), {textHtml: html, textSiyuan: ""});
    });

    it("preserves literal and ambiguous legacy separators", () => {
        for (const html of [
            "正文__@text/siyuan@__正文",
            "<p>__@text/siyuan@__</p>",
            "<p>正文</p>__@text/siyuan@__<div>__@text/siyuan@__</div>",
        ]) {
            assert.deepEqual(getTextSiyuanFromTextHTML(html, true), {textHtml: html, textSiyuan: ""});
        }
    });

    it("prefers comment data and preserves literal separators in new HTML", () => {
        const textHtml = "<p>__@text/siyuan@__</p>";
        const textSiyuan = '<div data-type="NodeParagraph">中文 😀 __@text/siyuan@__</div>';
        assert.deepEqual(getTextSiyuanFromTextHTML(buildWebClipboardHTML(textHtml, textSiyuan), true), {
            textHtml, textSiyuan,
        });
    });

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

    it("reads direct SiYuan clipboard data first", () => {
        const directData = '<div data-type="NodeParagraph">Direct</div>';
        const embeddedData = '<div data-type="NodeParagraph">Embedded</div>';
        const clipboardData = new Map([
            ["text/siyuan", directData],
            ["text/html", buildWebClipboardHTML("<p>Embedded</p>", embeddedData)],
        ]);

        assert.equal(getTextSiyuanFromClipboardData({
            getData: (type) => clipboardData.get(type) || "",
        }), directData);
    });

    it("reads SiYuan data embedded in clipboard HTML", () => {
        const textSiyuan = '<div data-type="NodeHeading" data-subtype="h1">Title</div>';
        const clipboardData = new Map([
            ["text/html", buildWebClipboardHTML("<h1>Title</h1>", textSiyuan)],
        ]);

        assert.equal(getTextSiyuanFromClipboardData({
            getData: (type) => clipboardData.get(type) || "",
        }), textSiyuan);
    });
});
