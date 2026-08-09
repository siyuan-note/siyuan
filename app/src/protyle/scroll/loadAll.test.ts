import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {loadUntilDocumentBoundary} from "./loadAll";

describe("loadUntilDocumentBoundary", () => {
    it("does not request content when the boundary is already loaded", async () => {
        let requests = 0;

        const loaded = await loadUntilDocumentBoundary({
            isCurrent: () => true,
            isBoundaryLoaded: () => true,
            getBoundaryID: () => "first",
            load: async () => {
                requests++;
                return true;
            },
        });

        assert.equal(loaded, true);
        assert.equal(requests, 0);
    });

    it("continues loading while the boundary advances", async () => {
        let index = 0;
        const ids = ["third", "second", "first"];

        const loaded = await loadUntilDocumentBoundary({
            isCurrent: () => true,
            isBoundaryLoaded: () => index === ids.length - 1,
            getBoundaryID: () => ids[index],
            load: async () => {
                index++;
                return true;
            },
        });

        assert.equal(loaded, true);
        assert.equal(index, 2);
    });

    it("stops when loading fails", async () => {
        const loaded = await loadUntilDocumentBoundary({
            isCurrent: () => true,
            isBoundaryLoaded: () => false,
            getBoundaryID: () => "last",
            load: async () => false,
        });

        assert.equal(loaded, false);
    });

    it("stops when the document is no longer current", async () => {
        let current = true;
        let boundaryLoaded = false;

        const loaded = await loadUntilDocumentBoundary({
            isCurrent: () => current,
            isBoundaryLoaded: () => boundaryLoaded,
            getBoundaryID: () => "last",
            load: async () => {
                current = false;
                boundaryLoaded = true;
                return true;
            },
        });

        assert.equal(loaded, false);
    });

    it("stops when a successful request does not advance the boundary", async () => {
        const loaded = await loadUntilDocumentBoundary({
            isCurrent: () => true,
            isBoundaryLoaded: () => false,
            getBoundaryID: () => "last",
            load: async () => true,
        });

        assert.equal(loaded, false);
    });
});
