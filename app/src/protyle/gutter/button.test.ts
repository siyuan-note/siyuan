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

    it("escapes quote breakout payloads in the block subtype", () => {
        const html = genGutterBlockButtonHTML({
            ...baseOptions,
            subtype: 'x" autofocus onfocus=globalThis.__probe_marker=1 data-pad="y',
        });

        assert.match(html, /data-subtype="x&quot; autofocus onfocus=globalThis\.__probe_marker=1 data-pad=&quot;y"/);
        assert.match(html, /data-subtype="[^"]*"/);
        assert.doesNotMatch(html, /data-subtype="x"[^>]*\sautofocus/);
    });

    it("escapes quote breakout payloads in the block id", () => {
        const html = genGutterBlockButtonHTML({
            ...baseOptions,
            nodeID: 'x" onmouseover=alert(1)',
        });

        assert.match(html, /data-node-id="x&quot; onmouseover=alert\(1\)"/);
        assert.doesNotMatch(html, /data-node-id="x"[^>]*\sonmouseover=/);
    });

    it("escapes quotes in block type, tooltip and embed id", () => {
        const html = genGutterBlockButtonHTML({
            ...baseOptions,
            ariaLabel: 'tip" onfocus=alert(1)',
            type: 'NodeParagraph" autofocus',
            embedID: 'embed" onclick=alert(1)',
        });

        assert.match(html, /aria-label="tip&quot; onfocus=alert\(1\)"/);
        assert.match(html, /data-type="NodeParagraph&quot; autofocus"/);
        assert.match(html, /data-embed-id="embed&quot; onclick=alert\(1\)"/);
        assert.match(html, /aria-label="[^"]*"/);
        assert.match(html, /data-type="[^"]*"/);
        assert.match(html, /data-embed-id="[^"]*"/);
    });
});

describe("canShowGutterInsert", () => {
    it("allows insertion controls only for regular gutters", () => {
        assert.equal(canShowGutterInsert(), true);
        assert.equal(canShowGutterInsert("20260817120001-embed"), false);
    });
});
