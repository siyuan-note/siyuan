import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    buildWebClipboardHTML,
    getTextSiyuanFromClipboardData,
    getTextSiyuanFromTextHTML,
} from "./clipboardData";

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
