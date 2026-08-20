import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {canShowGutterInsert, genGutterBlockButtonHTML} from "./button";

describe("genGutterBlockButtonHTML", () => {
    const baseOptions = {
        ariaLabel: "Block menu",
        type: "NodeParagraph",
        subtype: "p",
        nodeID: "20260817120000-example",
        icon: "iconParagraph",
        draggable: true,
    };

    it("keeps regular gutters draggable and outside embed routing", () => {
        const html = genGutterBlockButtonHTML(baseOptions);

        assert.match(html, /draggable="true"/);
        assert.doesNotMatch(html, /data-embed-id=/);
    });

    it("routes embedded child gutters without making them draggable", () => {
        const html = genGutterBlockButtonHTML({
            ...baseOptions,
            embedID: "20260817120001-embed",
            draggable: false,
        });

        assert.match(html, /data-embed-id="20260817120001-embed"/);
        assert.doesNotMatch(html, /draggable="true"/);
    });

    it("keeps repeated view occurrences distinct", () => {
        const html = genGutterBlockButtonHTML({
            ...baseOptions,
            viewOccurrenceID: "fragment/second",
        });

        assert.match(html, /data-view-occurrence-id="fragment%2Fsecond"/);
    });
});

describe("canShowGutterInsert", () => {
    it("allows insertion controls only for regular gutters", () => {
        assert.equal(canShowGutterInsert(), true);
        assert.equal(canShowGutterInsert("20260817120001-embed"), false);
    });
});
