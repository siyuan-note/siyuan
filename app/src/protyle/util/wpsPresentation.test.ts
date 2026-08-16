import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    extractWPSPresentationClipboard,
    getWPSPresentationFallback,
    parseWPSPresentationClipboard,
    shouldConvertWPSPresentation,
} from "./wpsPresentation";

describe("WPS presentation clipboard", () => {
    it("prefers texts and reads the original case-insensitive MIME type", () => {
        const requested: string[] = [];
        const payload = extractWPSPresentationClipboard(["WPS/OBJECTS", "Wps/Texts"], (type) => {
            requested.push(type);
            return type.toLowerCase() === "wps/texts" ? JSON.stringify({data: "texts-data"}) :
                JSON.stringify({data: "objects-data"});
        });

        assert.deepEqual(payload, {data: "texts-data", type: "texts"});
        assert.deepEqual(requested, ["Wps/Texts"]);
    });

    it("falls back to objects when texts is invalid", () => {
        const payload = extractWPSPresentationClipboard(["wps/texts", "wps/objects"], (type) => {
            return type === "wps/texts" ? "invalid" : JSON.stringify({data: "objects-data"});
        });

        assert.deepEqual(payload, {data: "objects-data", type: "objects"});
    });

    it("continues with objects when reading texts throws", () => {
        const payload = extractWPSPresentationClipboard(["wps/texts", "wps/objects"], (type) => {
            if (type === "wps/texts") {
                throw new Error("denied");
            }
            return JSON.stringify({data: "objects-data"});
        });

        assert.deepEqual(payload, {data: "objects-data", type: "objects"});
    });

    it("rejects malformed, empty, and oversized payload data", () => {
        assert.equal(parseWPSPresentationClipboard("invalid", "texts"), undefined);
        assert.equal(parseWPSPresentationClipboard(JSON.stringify({data: 1}), "texts"), undefined);
        assert.equal(parseWPSPresentationClipboard(JSON.stringify({data: "  "}), "texts"), undefined);
        assert.equal(parseWPSPresentationClipboard(JSON.stringify({data: "1234"}), "texts", 3), undefined);
        assert.deepEqual(parseWPSPresentationClipboard(JSON.stringify({data: "123"}), "texts", 3), {
            data: "123",
            type: "texts",
        });
    });

    it("converts only when external HTML and SiYuan HTML are absent", () => {
        const payload = {data: "data", type: "texts"} as const;
        assert.equal(shouldConvertWPSPresentation(payload, "", ""), true);
        assert.equal(shouldConvertWPSPresentation(payload, " \n", "\t"), true);
        assert.equal(shouldConvertWPSPresentation(payload, "<p>text</p>", ""), false);
        assert.equal(shouldConvertWPSPresentation(payload, "", "<div data-type=\"NodeParagraph\"></div>"), false);
        assert.equal(shouldConvertWPSPresentation(undefined, "", ""), false);
    });

    it("uses plain text for texts and files for objects when available", () => {
        assert.equal(getWPSPresentationFallback("texts", true), "plainText");
        assert.equal(getWPSPresentationFallback("objects", true), "files");
        assert.equal(getWPSPresentationFallback("objects", false), "plainText");
    });
});
