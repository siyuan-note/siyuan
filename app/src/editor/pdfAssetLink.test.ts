import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {appendPdfAnnotationId, getPdfAnnotationReference, resolvePdfAssetLink} from "./pdfAssetLink";

describe("PDF asset link resolution", () => {
    it("keeps an ordinary PDF asset unchanged", () => {
        assert.deepEqual(resolvePdfAssetLink("assets/document.pdf"), {
            linkAddress: "assets/document.pdf",
            pdfParams: undefined,
        });
    });

    it("extracts a page parameter without leaving it in the asset URL", () => {
        assert.deepEqual(resolvePdfAssetLink("assets/document.pdf?page=12"), {
            linkAddress: "assets/document.pdf",
            pdfParams: 12,
        });
    });

    it("resolves uppercase PDF extensions", () => {
        assert.deepEqual(resolvePdfAssetLink("assets/document.PDF?page=7"), {
            linkAddress: "assets/document.PDF",
            pdfParams: 7,
        });
    });

    it("preserves non-page parameters when page is first", () => {
        assert.deepEqual(resolvePdfAssetLink("assets/document.pdf?page=3&box=20240101000000-abcdefg&dataPath=%2Fdocs%2Fnote.sy"), {
            linkAddress: "assets/document.pdf?box=20240101000000-abcdefg&dataPath=%2Fdocs%2Fnote.sy",
            pdfParams: 3,
        });
    });

    it("preserves non-page parameters when page is last", () => {
        assert.deepEqual(resolvePdfAssetLink("assets/document.pdf?box=20240101000000-abcdefg&dataPath=%2Fdocs%2Fnote.sy&page=4"), {
            linkAddress: "assets/document.pdf?box=20240101000000-abcdefg&dataPath=%2Fdocs%2Fnote.sy",
            pdfParams: 4,
        });
    });

    it("preserves non-page parameters when page is in the middle", () => {
        assert.deepEqual(resolvePdfAssetLink("assets/document.pdf?box=20240101000000-abcdefg&page=5&dataPath=%2Fdocs%2Fnote.sy"), {
            linkAddress: "assets/document.pdf?box=20240101000000-abcdefg&dataPath=%2Fdocs%2Fnote.sy",
            pdfParams: 5,
        });
    });

    it("extracts an annotation ID and preserves its asset parameters", () => {
        assert.deepEqual(resolvePdfAssetLink("assets/document.pdf/20240102123456-abcdefg?box=20240101000000-hijklmn&dataPath=%2Fdocs%2Fnote.sy"), {
            linkAddress: "assets/document.pdf?box=20240101000000-hijklmn&dataPath=%2Fdocs%2Fnote.sy",
            pdfParams: "20240102123456-abcdefg",
        });
    });

    it("keeps the box query compatible with the annotation sidecar suffix", () => {
        const resolved = resolvePdfAssetLink("assets/document.pdf?page=3&box=20240101000000-abcdefg");
        assert.equal(resolved.linkAddress + ".sya", "assets/document.pdf?box=20240101000000-abcdefg.sya");
    });

    it("uses an annotation ID instead of an accompanying page parameter", () => {
        assert.deepEqual(resolvePdfAssetLink("assets/document.pdf/20240102123456-abcdefg?page=8&box=20240101000000-hijklmn"), {
            linkAddress: "assets/document.pdf?box=20240101000000-hijklmn",
            pdfParams: "20240102123456-abcdefg",
        });
    });

    it("round-trips a copied annotation link with asset parameters", () => {
        const linkAddress = appendPdfAnnotationId(
            "assets/document.pdf?box=20240101000000-hijklmn&dataPath=%2Fdocs%2Fnote.sy",
            "20240102123456-abcdefg",
        );
        assert.equal(linkAddress,
            "assets/document.pdf/20240102123456-abcdefg?box=20240101000000-hijklmn&dataPath=%2Fdocs%2Fnote.sy");
        assert.deepEqual(resolvePdfAssetLink(linkAddress), {
            linkAddress: "assets/document.pdf?box=20240101000000-hijklmn&dataPath=%2Fdocs%2Fnote.sy",
            pdfParams: "20240102123456-abcdefg",
        });
    });

    it("drops fragments and preserves the original encoding of non-page parameters", () => {
        assert.deepEqual(resolvePdfAssetLink("assets/document.pdf?dataPath=%2Fdocs%2Fa%20b.sy&page=6#view"), {
            linkAddress: "assets/document.pdf?dataPath=%2Fdocs%2Fa%20b.sy",
            pdfParams: 6,
        });
    });

    it("leaves non-PDF and non-asset links unchanged", () => {
        assert.deepEqual(resolvePdfAssetLink("assets/document.txt?page=2"), {
            linkAddress: "assets/document.txt?page=2",
        });
        assert.deepEqual(resolvePdfAssetLink("https://example.com/document.pdf?page=2"), {
            linkAddress: "https://example.com/document.pdf?page=2",
        });
    });
});

describe("PDF annotation reference parsing", () => {
    const annotationId = "20240102123456-abcdefg";
    const query = "?box=20240101000000-hijklmn&dataPath=/docs/a%20b.sy";

    it("round-trips copied references through the bundled Lute parser", () => {
        require("../../stage/protyle/js/lute/lute.min.js");
        const lute = Lute.New();
        lute.SetFileAnnotationRef(true);
        lute.SetTextMark(true);
        lute.SetProtyleWYSIWYG(true);
        for (const path of ["assets/a.pdf", "assets/文档.PDF", "assets/folder/a%20b.pdf",
            "assets/document-20240101000000-hijklmn.pdf"]) {
            for (const suffix of ["", query]) {
                const reference = appendPdfAnnotationId(path + suffix, annotationId);
                const markdown = `<<${reference} "anchor">>`;
                assert.equal(getPdfAnnotationReference(markdown), reference);
                const dom = lute.Md2BlockDOM(markdown);
                assert.ok(dom.includes(`data-id="${Lute.EscapeHTMLStr(reference)}"`), dom);
                assert.equal(lute.BlockDOM2StdMd(dom).trim(), markdown);
                assert.deepEqual(resolvePdfAssetLink(reference), {linkAddress: path + suffix, pdfParams: annotationId});
            }
        }
    });

    it("accepts empty anchors, escaped quotes and anchorless references", () => {
        const reference = `assets/a.pdf/${annotationId}${query}`;
        for (const anchor of ["", " \"\"", " \"a \\\"quote\\\"\""]) {
            assert.equal(getPdfAnnotationReference(`<<${reference}${anchor}>>`), reference);
        }
    });

    it("inserts the annotation before fragments", () => {
        assert.equal(appendPdfAnnotationId("assets/a.pdf#view", annotationId), `assets/a.pdf/${annotationId}#view`);
        assert.equal(appendPdfAnnotationId("assets/a.pdf" + query + "#view", annotationId),
            `assets/a.pdf/${annotationId}${query}#view`);
    });

    it("rejects invalid paths, IDs and incomplete syntax", () => {
        for (const reference of [`assets/a.txt/${annotationId}`, `a.pdf/${annotationId}`,
            `assets/../a.pdf/${annotationId}`, `assets//a.pdf/${annotationId}`,
            `assets/a.pdf/${annotationId}x`, "assets/a.pdf/20240102123456-ABCDEF_",
            `assets/<a>.pdf/${annotationId}`]) {
            assert.equal(getPdfAnnotationReference(`<<${reference} "anchor">>`), undefined);
        }
        assert.equal(getPdfAnnotationReference(`<<assets/a.pdf/${annotationId} "anchor">`), undefined);
    });
});
