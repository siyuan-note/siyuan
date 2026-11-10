import assert from "node:assert/strict";
import {test} from "node:test";
import {DocTreeModel, getDocTreeWindow} from "./DocTreeModel";
import type {IDocTreeRange} from "./types";

const file = (id: string, subFileCount = 0): IFile => ({id, name: id, path: `/${id}.sy`, subFileCount,
    icon: "", name1: "", alias: "", memo: "", bookmark: "", hMtime: "", hCtime: "", hSize: "", count: 0});
const range = (files: IFile[], total: number, offset = 0, revision = "one"): IDocTreeRange => ({
    box: "box", parentID: "", path: "/", files, total, offset, limit: files.length,
    effectiveSortMode: 0, revision, stale: false,
});

test("sparse document tree locates a far row without allocating missing siblings", () => {
    const model = new DocTreeModel();
    model.setRoots([{id: "box", notebookId: "box", path: "/", name: "Box", kind: "notebook", subFileCount: 100000}]);
    const root = model.roots[0];
    model.expanded.set(root.occurrenceKey, root);
    model.applyRange(model.directory(root), range([file("far")], 100000, 90000));
    assert.equal(model.rowCount, 100001);
    assert.equal(model.rowAt(90001)?.item?.id, "far");
    assert.equal(model.rowAt(50000)?.item, undefined);
    assert.equal(model.indexOf("notebook:box/far"), 90001);
    assert.equal(model.directory(root).files.size, 1);
    const saved = model.getItem("notebook:box/far");
    model.directory(root).files.clear();
    model.directory(root).indices.clear();
    assert.equal(model.indexOf(saved.occurrenceKey, saved), 90001);
    model.invalidate("box");
    assert.equal(model.rowCount, 100001, "refresh preserves placeholder geometry until the new range arrives");
    model.applyRange(model.directory(root), range([], 0, 0, "two"));
    assert.equal(model.rowCount, 1, "the new total replaces the old estimate");
});

test("expanded descendants have independent occurrence positions under duplicate roots", () => {
    const model = new DocTreeModel();
    model.setRoots(["first", "second"].map(occurrenceKey => ({id: "parent", notebookId: "box", path: "/parent.sy",
        name: "Parent", kind: "document", subFileCount: 2, occurrenceKey})));
    const [first, second] = model.roots;
    model.expanded.set(first.occurrenceKey, first);
    model.applyRange(model.directory(first), range([file("a", 1), file("b")], 2));
    const child = model.child(first, 0);
    model.expanded.set(child.occurrenceKey, child);
    model.applyRange(model.directory(child), range([file("grandchild")], 1));
    assert.equal(model.rowCount, 5);
    assert.equal(model.indexOf(second.occurrenceKey), 4);
    assert.equal(model.rowAt(2)?.item?.id, "grandchild");
    model.expanded.set(second.occurrenceKey, second);
    model.project();
    assert.equal(model.rowCount, 7);
    assert.equal(model.rowAt(5)?.item?.occurrenceKey, "second/a");
    assert.equal(model.expanded.has("second/a"), false);
});

test("a revised sibling order cannot attach an old expanded subtree to another document", () => {
    const model = new DocTreeModel();
    model.setRoots([{id: "box", notebookId: "box", path: "/", name: "Box", kind: "notebook", subFileCount: 2}]);
    const root = model.roots[0];
    model.expanded.set(root.occurrenceKey, root);
    model.applyRange(model.directory(root), range([file("a", 1), file("b")], 2));
    const a = model.child(root, 0);
    model.expanded.set(a.occurrenceKey, a);
    model.applyRange(model.directory(a), range([file("child")], 1));
    model.applyRange(model.directory(root), range([file("b"), file("a", 1)], 2, 0, "two"));
    assert.equal(model.rowCount, 3);
    assert.equal(model.rowAt(2)?.item?.id, "a");
    const moved = model.child(root, 1);
    model.expanded.set(moved.occurrenceKey, moved);
    model.project();
    assert.equal(model.rowAt(3)?.item?.id, "child");
    model.invalidate("box");
    assert.equal(model.getItem(a.occurrenceKey), undefined);
});

test("viewport size remains bounded at the beginning, middle, and end of a large tree", () => {
    for (const count of [0, 1, 31, 32, 33, 10000, 100000]) {
        for (const top of [0, count * 14, count * 28]) {
            const window = getDocTreeWindow(count, top, 280, 28);
            assert.ok(window.end - window.start <= 26);
            assert.ok(window.start >= 0 && window.end <= count);
            assert.equal(window.before + (window.end - window.start) * 28 + window.after, count * 28);
        }
    }
});

test("navigation projects a staged child without publishing its directory snapshot", () => {
    const model = new DocTreeModel();
    model.setRoots([{id: "box", notebookId: "box", path: "/", name: "Box", kind: "notebook", subFileCount: 1}]);
    const root = model.roots[0];
    const directory = model.directory(root);
    model.applyRange(directory, range([file("old")], 1));
    const snapshot = {...directory, total: 100, effectiveSortMode: 3,
        files: new Map([[90, file("target")]]), indices: new Map([["target", 90]])};
    const child = model.child(root, 90, snapshot);
    assert.equal(child.id, "target");
    assert.equal(child.setSize, 100);
    assert.equal(child.effectiveSortMode, 3);
    assert.equal(child.occurrenceKey, "notebook:box/target");
    assert.equal(directory.total, 1);
    assert.equal(directory.files.get(0).id, "old");
    assert.equal(model.getItem(child.occurrenceKey), undefined);
    assert.equal(model.rowCount, 1);
});

test("refresh retains a complete old directory until replacement and deletion compacts cached ranges", () => {
    const model = new DocTreeModel();
    model.setRoots([{id: "box", notebookId: "box", path: "/", name: "Box", kind: "notebook", subFileCount: 6}]);
    const root = model.roots[0];
    model.expanded.set(root.occurrenceKey, root);
    model.applyRange(model.directory(root), range([file("a"), file("b"), file("c", 1)], 6));
    model.applyRange(model.directory(root), range([file("f")], 6, 5));
    const c = model.child(root, 2);
    model.expanded.set(c.occurrenceKey, c);
    model.applyRange(model.directory(c), range([file("child")], 1));
    model.invalidate("box", undefined, true);
    assert.equal(model.rowAt(2).item.id, "b", "waiting for refresh retains visible source metadata");
    model.removeDocuments(new Set(["a", "b"]));
    assert.equal(model.rowCount, 6);
    assert.equal(model.rowAt(1).item.id, "c");
    assert.equal(model.rowAt(2).item.id, "child", "remaining expanded branches follow their compacted parent index");
    assert.equal(model.directory(root).indices.get("f"), 3, "sparse cached pages shift without allocating their holes");
    assert.equal(model.getItem("notebook:box/a"), undefined);
});
