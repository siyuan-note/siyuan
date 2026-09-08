import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {decodeTableCellRich, encodeTableCellRich} from "./tableCellRichValue";
import {configureAVRichTextLute} from "../render/av/richTextValue";

describe("table cell rich text wire format", () => {
    it("preserves Unicode, literal Markdown, pipes, and line breaks without changing the source", () => {
        const source = "- **文本** 🧪\n\n```go\na | b\nc\n```\n\n\\*literal\\*";
        const encoded = encodeTableCellRich(source);
        assert.match(encoded, /^[A-Za-z0-9_-]+$/);
        assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")), {
            spec: 1, format: "kramdown", content: source,
        });
        assert.equal(decodeTableCellRich(encoded).content, source);
        assert.equal(decodeTableCellRich(encodeTableCellRich("")).content, "");
    });

    it("rejects missing, null, future, and corrupt payloads instead of treating them as plain text", () => {
        for (const value of [null, {}, [],
            {spec: 2, format: "kramdown", content: "source"},
            {spec: 1, format: "html", content: "source"},
            {spec: 1, format: "kramdown", content: null},
            {spec: 1, format: "kramdown", content: "before\u0000after"},
            {spec: 1, format: "kramdown", content: "source", unknown: true},
        ]) {
            assert.throws(() => decodeTableCellRich(Buffer.from(JSON.stringify(value)).toString("base64url")));
        }
        for (const encoded of ["", "invalid!", "_w", "e30="]) {
            assert.throws(() => decodeTableCellRich(encoded));
        }
    });

    it("round-trips rich cells through the bundled parser and exports an inline Markdown projection", () => {
        if (typeof Lute === "undefined") {
            require("../../../stage/protyle/js/lute/lute.min.js");
        }
        const lute = Lute.New();
        lute.SetTextMark(true);
        lute.SetHTMLTag2TextMark(true);
        lute.SetKramdownIAL(true);
        lute.SetSpin(true);
        lute.SetProtyleWYSIWYG(true);
        lute.SetSanitize(true);
        configureAVRichTextLute(lute);
        const source = "- **first**\n- second\n\n```go\na | b\nc\n```\n\n![image](assets/image.png)";
        const encoded = encodeTableCellRich(source);
        let html = "<div data-type=\"NodeTable\" data-node-id=\"20260908000001-table01\"><div contenteditable=\"true\">" +
            `<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td data-sy-table-cell-rich="${encoded}"></td>` +
            "</tr></tbody></table></div></div>";
        for (let index = 0; index < 3; index++) {
            html = lute.SpinBlockDOM(html);
            assert.equal(decodeTableCellRich(html.match(/data-sy-table-cell-rich="([^"]+)"/)[1]).content, source);
            assert.match(html, /<ul>/);
            assert.match(html, /assets\/image.png/);
            assert.equal((html.match(/data-node-id=/g) || []).length, 1);
        }
        const markdown = lute.BlockDOM2StdMd(html);
        assert.match(markdown, /first/);
        assert.match(markdown, /a.*b/);
        assert.doesNotMatch(markdown, /table-cell-rich|```go/);
        assert.match(lute.BlockDOM2InlineBlockDOM(html), /a.*b/);
    });
});
