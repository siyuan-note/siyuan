import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {escapeAVItemLinkText, formatAVItemLinks, genAVItemLink} from "./itemLink";

describe("database item links", () => {
    it("generates links with the current item location", () => {
        assert.equal(
            genAVItemLink("database-id", "view-id", "item-id"),
            "siyuan://blocks/database-id?avViewID=view-id&avItemID=item-id",
        );
        assert.equal(
            genAVItemLink("database-id", "view-id", "item-id", "group-id"),
            "siyuan://blocks/database-id?avViewID=view-id&avItemID=item-id&avGroupID=group-id",
        );
    });

    it("formats multiple hyperlinks as an unordered list", () => {
        assert.equal(formatAVItemLinks([
            {content: "Item 1", link: "siyuan://item-1"},
            {content: "Item 2", link: "siyuan://item-2"},
        ], false), "- siyuan://item-1\n- siyuan://item-2");
    });

    it("uses escaped primary key text in Markdown links", () => {
        assert.equal(
            escapeAVItemLinkText("Line 1\r\nLine \\[2] and [3]"),
            "Line 1 Line \\\\\\[2\\] and \\[3\\]",
        );
        assert.equal(formatAVItemLinks([
            {content: "Line 1\nLine [2]", link: "siyuan://item-1"},
            {content: "", link: "siyuan://item-2"},
        ], true), "- [Line 1 Line \\[2\\]](siyuan://item-1)\n- [siyuan://item-2](siyuan://item-2)");
    });

    it("does not add a list marker for one item", () => {
        assert.equal(
            formatAVItemLinks([{content: "Item", link: "siyuan://item"}], true),
            "[Item](siyuan://item)",
        );
    });
});
