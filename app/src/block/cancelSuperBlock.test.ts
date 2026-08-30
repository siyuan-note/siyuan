import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {appendCancelSuperBlockOperations, buildCancelSuperBlockOperations} from "./cancelSuperBlock";

describe("buildCancelSuperBlockOperations", () => {
    it("moves every direct child with stable forward and undo anchors", () => {
        const result = buildCancelSuperBlockOperations({
            id: "super-block",
            data: "<div></div>",
            childIDs: ["heading", "paragraph"],
            foldedHeadingIDs: [],
            previousID: "before",
            parentID: "document",
        });

        assert.deepEqual(result.doOperations, [{
            action: "move",
            id: "heading",
            previousID: "before",
            parentID: "document",
        }, {
            action: "move",
            id: "paragraph",
            previousID: "heading",
            parentID: "document",
        }, {
            action: "delete",
            id: "super-block",
        }]);
        assert.deepEqual(result.undoOperations, [{
            action: "insert",
            id: "super-block",
            data: "<div></div>",
            previousID: "before",
            parentID: "document",
        }, {
            action: "move",
            id: "heading",
            previousID: undefined,
            parentID: "super-block",
        }, {
            action: "move",
            id: "paragraph",
            previousID: "heading",
            parentID: "super-block",
        }]);
    });

    it("temporarily unfolds direct headings and restores nested folds from inside out", () => {
        const result = buildCancelSuperBlockOperations({
            id: "super-block",
            data: "<div></div>",
            childIDs: ["heading-1", "heading-2", "paragraph"],
            foldedHeadingIDs: ["heading-1", "heading-2"],
            parentID: "document",
        });

        assert.deepEqual(result.doOperations.map(operation => `${operation.action}:${operation.id}`), [
            "unfoldHeading:heading-1",
            "unfoldHeading:heading-2",
            "move:heading-1",
            "move:heading-2",
            "move:paragraph",
            "delete:super-block",
            "foldHeading:heading-2",
            "foldHeading:heading-1",
        ]);
        assert.deepEqual(result.undoOperations.map(operation => `${operation.action}:${operation.id}`), [
            "unfoldHeading:heading-1",
            "unfoldHeading:heading-2",
            "insert:super-block",
            "move:heading-1",
            "move:heading-2",
            "move:paragraph",
            "foldHeading:heading-2",
            "foldHeading:heading-1",
        ]);
        assert.equal(result.undoOperations.some(operation => operation.id === "outside"), false);
    });
});

describe("appendCancelSuperBlockOperations", () => {
    it("keeps cancellation before restoring the dragged block during undo", () => {
        const doOperations = [{action: "move", id: "dragged"}] as IOperation[];
        const undoOperations = [{action: "move", id: "dragged"}] as IOperation[];
        appendCancelSuperBlockOperations(doOperations, undoOperations, {
            doOperations: [
                {action: "move", id: "remaining"},
                {action: "delete", id: "super-block"},
            ],
            undoOperations: [
                {action: "insert", id: "super-block"},
                {action: "move", id: "remaining"},
            ],
        });

        assert.deepEqual(doOperations.map(operation => `${operation.action}:${operation.id}`), [
            "move:dragged",
            "move:remaining",
            "delete:super-block",
        ]);
        assert.deepEqual(undoOperations.reverse().map(operation => `${operation.action}:${operation.id}`), [
            "insert:super-block",
            "move:remaining",
            "move:dragged",
        ]);
    });
});
