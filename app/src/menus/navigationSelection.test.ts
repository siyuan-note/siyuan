import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getDocTreeDeleteTargets,
    getDocTreeMenuItems,
    getDocTreeMenuType,
    isDocTreeDragSelectionAllowed
} from "./navigationSelection";

const createItem = (type: "navigation-file" | "navigation-root", options: {
    id?: string,
    notebookId?: string,
    path: string,
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
        return null;
    },
    closest(selector: string) {
        if (selector !== "ul[data-url]") {
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
