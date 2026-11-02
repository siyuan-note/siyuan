import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getRelativeReorderRequest,
    parseDocumentTabDragData,
    parseDocumentTreeDragData,
} from "./fileTreeMove";

describe("getRelativeReorderRequest", () => {
    it("keeps source order and encodes the relative position", () => {
        const sourceIDs = ["20260802120000-abcdefg", "20260802120001-abcdefg"];

        assert.deepEqual(getRelativeReorderRequest(sourceIDs, "20260802120002-abcdefg", false), {
            sourceIDs,
            targetID: "20260802120002-abcdefg",
            position: "before",
        });
        assert.equal(getRelativeReorderRequest(sourceIDs, "20260802120002-abcdefg", true).position, "after");
    });
});

describe("parseDocumentTabDragData", () => {
    it("parses a document tab payload", () => {
        assert.deepEqual(parseDocumentTabDragData(JSON.stringify({
            rootId: "20260802120000-abcdefg",
            tabId: "tab-id",
            title: "Document",
        })), {
            rootId: "20260802120000-abcdefg",
            tabId: "tab-id",
            title: "Document",
        });
    });

    it("rejects non-document payloads", () => {
        assert.equal(parseDocumentTabDragData(JSON.stringify({
            rootId: "invalid",
            tabId: "tab-id",
            title: "Document",
        })), undefined);
    });
});

describe("parseDocumentTreeDragData", () => {
    it("parses and deduplicates document IDs", () => {
        assert.deepEqual(parseDocumentTreeDragData(JSON.stringify({
            ids: ["20260802120000-abcdefg", "20260802120000-abcdefg", "20260802120001-hijklmn"],
        })), {
            ids: ["20260802120000-abcdefg", "20260802120001-hijklmn"],
        });
    });

    it("rejects empty or invalid document selections", () => {
        assert.equal(parseDocumentTreeDragData(JSON.stringify({ids: []})), undefined);
        assert.equal(parseDocumentTreeDragData(JSON.stringify({ids: ["invalid"]})), undefined);
    });
});
