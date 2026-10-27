import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getDocTreeDeleteTargets,
    getDocTreeActionItems,
    getDocTreeTopPaths,
    getDocTreeMenuItems,
    getDocTreeMenuType,
    isDocTreeDragSelectionAllowed
} from "./navigationSelection";

const createItem = (type: "navigation-file" | "navigation-root", options: {
    id?: string,
    notebookId?: string,
    path: string,
    flat?: boolean,
}) => ({
    getAttribute(name: string) {
        if (name === "data-type") {
            return type;
        }
        if (name === "data-node-id") {
            return options.id || null;
        }
        if (name === "data-path") {
            return options.path;
        }
        if (name === "data-notebook-id" && options.flat) {
            return options.notebookId;
        }
        return null;
    },
    closest(selector: string) {
        if (options.flat || selector !== "ul[data-url]") {
            return null;
        }
        return {
            getAttribute(name: string) {
                return name === "data-url" ? options.notebookId || null : null;
            }
        };
    },
}) as unknown as HTMLElement;

const doc1 = createItem("navigation-file", {id: "doc-1", notebookId: "notebook-1", path: "/doc-1.sy"});
const doc2 = createItem("navigation-file", {id: "doc-2", notebookId: "notebook-2", path: "/doc-2.sy"});
const notebook1 = createItem("navigation-root", {id: "box-doc-1", notebookId: "notebook-1", path: "/"});
const notebook2 = createItem("navigation-root", {notebookId: "notebook-2", path: "/"});

test("document tree menu type distinguishes all selection kinds", () => {
    assert.equal(getDocTreeMenuType([doc1]), "doc");
    assert.equal(getDocTreeMenuType([doc1, doc2]), "docs");
    assert.equal(getDocTreeMenuType([notebook1]), "notebook");
    assert.equal(getDocTreeMenuType([notebook1, notebook2]), "notebooks");
    assert.equal(getDocTreeMenuType([notebook1, doc1]), "items");
});

test("document tree drag rejects mixed selections", () => {
    assert.equal(isDocTreeDragSelectionAllowed([doc1]), true);
    assert.equal(isDocTreeDragSelectionAllowed([doc1, doc2]), true);
    assert.equal(isDocTreeDragSelectionAllowed([notebook1]), true);
    assert.equal(isDocTreeDragSelectionAllowed([notebook1, notebook2]), true);
    assert.equal(isDocTreeDragSelectionAllowed([notebook1, doc1]), false);
});

test("document tree menu items contain document and notebook identifiers", () => {
    assert.deepEqual(getDocTreeMenuItems([doc1, doc2, notebook1, notebook2]), [
        {id: "doc-1", path: "/doc-1.sy", notebookId: "notebook-1"},
        {id: "doc-2", path: "/doc-2.sy", notebookId: "notebook-2"},
        {id: "notebook-1", path: "/", notebookId: "notebook-1"},
        {id: "notebook-2", path: "/", notebookId: "notebook-2"},
    ]);
});

test("document tree menu items omit incomplete elements", () => {
    const missingID = createItem("navigation-file", {notebookId: "notebook-1", path: "/missing.sy"});
    const missingNotebookID = createItem("navigation-file", {id: "doc-3", path: "/doc-3.sy"});
    assert.deepEqual(getDocTreeMenuItems([doc1, missingID, missingNotebookID]), [
        {id: "doc-1", path: "/doc-1.sy", notebookId: "notebook-1"},
    ]);
});

test("mixed document tree deletion includes documents and notebooks", () => {
    assert.deepEqual(getDocTreeDeleteTargets([doc1, notebook1, doc2, notebook2]), {
        notebookIds: ["notebook-1", "notebook-2"],
        paths: ["/doc-1.sy", "/doc-2.sy"],
    });
});

test("offscreen document tree snapshots retain notebook identity without DOM ancestors", () => {
    const item = createItem("navigation-file", {id: "far", notebookId: "box", path: "/far.sy", flat: true});
    assert.deepEqual(getDocTreeMenuItems([item]), [{id: "far", path: "/far.sy", notebookId: "box"}]);
});

test("deleting selected pinned occurrences addresses each document once", () => {
    assert.deepEqual(getDocTreeDeleteTargets([doc1, doc1, notebook1, notebook1]), {
        notebookIds: ["notebook-1"], paths: ["/doc-1.sy"],
    });
});

test("document actions deduplicate occurrences while retaining same IDs in different notebooks", () => {
    const first = {id: "doc", notebookId: "first", occurrenceKey: "one"};
    const duplicate = {...first, occurrenceKey: "two"};
    const other = {...first, notebookId: "second"};
    assert.deepEqual(getDocTreeActionItems([first, duplicate, other]), [duplicate, other]);
});

test("moving selected documents excludes nested descendants while preserving the remaining selection order", () => {
    assert.deepEqual(getDocTreeTopPaths([
        {notebookId: "box", path: "/parent/child.sy", kind: "document"},
        {notebookId: "box", path: "/peer.sy", kind: "document"},
        {notebookId: "box", path: "/parent.sy", kind: "document"},
        {notebookId: "box", path: "/parent.sy", kind: "document"},
        {notebookId: "other", path: "/parent/child.sy", kind: "document"},
        {notebookId: "box", path: "/", kind: "notebook"},
    ]), ["/peer.sy", "/parent.sy", "/parent/child.sy"]);
});

test("move pruning preserves unordered document and notebook order while removing repeated occurrences", () => {
    assert.deepEqual(getDocTreeTopPaths([
        {notebookId: "z", path: "/z.sy", kind: "document"},
        {notebookId: "a", path: "/z.sy", kind: "document"},
        {notebookId: "z", path: "/z.sy", kind: "document"},
        {notebookId: "z", path: "/a.sy", kind: "document"},
    ]), ["/z.sy", "/z.sy", "/a.sy"]);
});
