import * as assert from "node:assert/strict";
import {before, describe, it} from "node:test";

let Constants: typeof import("../../constants").Constants;
let marker: typeof import("./inlineElementMarker");

before(async () => {
    Object.assign(globalThis, {NODE_ENV: "test", SIYUAN_VERSION: "test"});
    ({Constants} = await import("../../constants"));
    marker = await import("./inlineElementMarker");
});

describe("semantic inline markers", () => {
    it("distinguishes the external and internal placeholders", () => {
        assert.equal(Constants.ZWSP, "\u200b");
        assert.equal(Constants.WORD_JOINER, "\u2060");
        assert.equal(marker.getInlinePlaceholder("strong"), Constants.ZWSP);
        assert.equal(marker.getInlinePlaceholder("strong code"), Constants.WORD_JOINER);
    });

    it("recognizes code, tag and kbd in compound inline types", () => {
        assert.equal(marker.hasSemanticInlineType("strong code"), true);
        assert.equal(marker.hasSemanticInlineType("tag"), true);
        assert.equal(marker.hasSemanticInlineType("em kbd"), true);
        assert.equal(marker.hasSemanticInlineType("strong em"), false);
    });

    it("normalizes every supported legacy prefix without touching visible content", () => {
        for (const markerChar of ["\u200b", "\ufeff", "\u2060"]) {
            assert.equal(marker.getSemanticInternalMarkerPrefixLength(markerChar + "value"), 1);
            assert.equal(marker.stripSemanticInternalMarkerPrefix(markerChar + "value"), "value");
            assert.equal(marker.normalizeSemanticInternalMarkerPrefix(markerChar + "value"), "\u2060value");
        }
        assert.equal(marker.normalizeSemanticInternalMarkerPrefix("\u200b\ufeff\u2060value"), "\u2060value");
        assert.equal(marker.normalizeSemanticInternalMarkerPrefix(""), "\u2060");
        assert.equal(marker.stripSemanticInternalMarkerPrefix("va\u2060lue"), "va\u2060lue");
    });

    it("builds canonical spans with external boundaries after ordinary text", () => {
        for (const type of ["code", "tag", "kbd"] as const) {
            const html = "before" + marker.buildSemanticInlineHTML(type, "value") + "after";
            assert.equal(html, `before\u200b<span data-type="${type}">\u2060value</span>\u200bafter`);
        }
    });

    it("removes exact structural offsets without consuming user-authored word joiners", () => {
        const text = "plain\u2060\u2060value\ufeff";
        assert.equal(marker.removeTextOffsets(text, [6, 12]), "plain\u2060value");
        assert.equal(marker.normalizeSemanticInternalMarkerPrefix("\u2060value", "legacy"), "\u200bvalue");
        assert.equal(marker.normalizeSemanticInternalMarkerPrefix("\ufeffvalue", "remove"), "value");
    });

    it("normalizes a caret before the internal marker before forward deletion", () => {
        assert.equal(marker.getSemanticForwardDeleteOffset("\u2060value", 0), 1);
        assert.equal(marker.getSemanticForwardDeleteOffset("\u2060value", 1), 1);
        assert.equal(marker.getSemanticForwardDeleteOffset("value", 0), 0);
        assert.equal(marker.isSemanticBackwardDeleteBoundary("\u2060value", 0), true);
        assert.equal(marker.isSemanticBackwardDeleteBoundary("\u2060value", 1), true);
        assert.equal(marker.isSemanticBackwardDeleteBoundary("\u2060value", 2), false);
    });

    it("does not parse non-HTML clipboard payloads containing angle brackets", () => {
        const json = JSON.stringify({value: "a < b > c", html: "<code>not BlockDOM</code>"});
        assert.equal(marker.transformSemanticInlineHTML(json, "legacy"), json);
        assert.equal(marker.transformSemanticInlineHTML(json, "remove"), json);
    });
});
