import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getParentDocumentID} from "./parentDocument";

describe("getParentDocumentID", () => {
    it("returns the physical parent of a nested document", () => {
        assert.equal(getParentDocumentID({
            path: "/20260818120000-parent1/20260818120001-parent2/20260818120002-child.sy",
            notebookID: "20260818120003-notebook",
            rootID: "20260818120002-child",
            boxDocEnabled: false,
        }), "20260818120001-parent2");
    });

    it("returns the notebook document for a top-level document when enabled", () => {
        assert.equal(getParentDocumentID({
            path: "/20260818120002-child.sy",
            notebookID: "20260818120003-notebook",
            rootID: "20260818120002-child",
            boxDocEnabled: true,
        }), "20260818120003-notebook");
    });

    it("does not return the notebook document when disabled", () => {
        assert.equal(getParentDocumentID({
            path: "/20260818120002-child.sy",
            notebookID: "20260818120003-notebook",
            rootID: "20260818120002-child",
            boxDocEnabled: false,
        }), undefined);
    });

    it("does not return a parent for the notebook document itself", () => {
        assert.equal(getParentDocumentID({
            path: "/20260818120003-notebook.sy",
            notebookID: "20260818120003-notebook",
            rootID: "20260818120003-notebook",
            boxDocEnabled: true,
        }), undefined);
    });
});
