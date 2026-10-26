import * as assert from "node:assert/strict";
import {test} from "node:test";
import {collectDocTreeState, restoreDocTreeStateData} from "./docTreeStateCore";
import type {IDocTreeExpansion, IDocTreeItem} from "../layout/dock/docTree/types";

const expanded = (id: string, kind: "document" | "notebook" = "document"): IDocTreeExpansion => ({
    id, notebookId: "box", kind, occurrenceKey: `box/${id}`, path: `/${id}.sy`,
});

const fixture = () => {
    const calls: string[] = [];
    const restored: Pick<IDocTreeExpansion, "id" | "kind" | "notebookId">[] = [];
    const anchor: {value?: {occurrenceKey?: string, offset: number}} = {};
    let found = true;
    const controller: Parameters<typeof restoreDocTreeStateData>[0] = {
        getExpandedItems: () => [],
        getScrollAnchor: () => ({index: 0, offset: 0}),
        restoreExpanded: async items => {
            restored.push(...items);
            calls.push("expand:" + items[0].id);
        },
        locate: async (notebookId, id) => {
            calls.push(`locate:${notebookId}/${id}`);
            // 不在屏幕内时定位接口可以不返回 DOM，但数据中的目标仍存在。
            return undefined;
        },
        findItem: (notebookId, id) => found ? {
            ...expanded(id), notebookId, occurrenceKey: `box/new-parent/${id}`, index: 700,
        } as IDocTreeItem : undefined,
        restoreScrollAnchor: value => { anchor.value = value; },
    };
    return {controller, calls, restored, anchor, removeTarget: () => { found = false; }};
};

test("document tree state stores IDs and an anchor without document titles or paths", () => {
    const state = collectDocTreeState({
        getExpandedItems: () => [expanded("box", "notebook"), expanded("parent"), expanded("parent")],
        getScrollAnchor: () => ({notebookId: "box", id: "far", occurrenceKey: "old/path/far", index: 900, offset: 9}),
    });
    assert.deepEqual(state, [{notebookId: "box", openPaths: [], version: 2,
        expandedIDs: [{id: "box", kind: "notebook"}, {id: "parent", kind: "document"}],
        scrollAnchor: {id: "far", offset: 9}}]);
    assert.equal(JSON.stringify(state).includes(".sy"), false);
});

test("document tree restoration reads legacy paths without expanding the saved leaf", async () => {
    const f = fixture();
    await restoreDocTreeStateData(f.controller, [{notebookId: "box", openPaths: ["/parent/leaf.sy", "/parent/other.sy"]}]);
    assert.deepEqual(f.restored, [
        {notebookId: "box", id: "box", kind: "notebook"},
        {notebookId: "box", id: "parent", kind: "document"},
    ]);
});

test("document tree restoration locates a moved offscreen anchor by ID", async () => {
    const f = fixture();
    await restoreDocTreeStateData(f.controller, [{notebookId: "box", openPaths: [], version: 2,
        expandedIDs: [{id: "parent", kind: "document"}], scrollAnchor: {id: "far", offset: 11}}]);
    assert.deepEqual(f.calls, ["expand:parent", "locate:box/far"]);
    assert.equal(f.anchor.value.occurrenceKey, "box/new-parent/far");
    assert.equal(f.anchor.value.offset, 11);
});

test("document tree restoration tolerates removed anchors and malformed local state", async () => {
    const f = fixture();
    f.removeTarget();
    await restoreDocTreeStateData(f.controller, [{notebookId: "box", openPaths: [], version: 2,
        scrollAnchor: {id: "gone", offset: 5}}]);
    assert.equal(f.anchor.value, undefined);
    await restoreDocTreeStateData(f.controller, undefined);
    assert.deepEqual(f.calls, ["locate:box/gone"]);
});

test("a superseded document tree restoration stops before later expansions and anchor changes", async () => {
    const f = fixture();
    let current = true;
    f.controller.restoreExpanded = async items => {
        f.restored.push(...items);
        current = false;
    };
    await restoreDocTreeStateData(f.controller, [{notebookId: "box", openPaths: [], version: 2,
        expandedIDs: [{id: "first", kind: "document"}, {id: "second", kind: "document"}],
        scrollAnchor: {id: "far", offset: 5}}], () => current);
    assert.deepEqual(f.restored.map(item => item.id), ["first"]);
    assert.deepEqual(f.calls, []);
    assert.equal(f.anchor.value, undefined);
});

test("an unavailable saved branch does not prevent restoring later branches", async t => {
    const errors: unknown[] = [];
    t.mock.method(console, "error", (error: unknown) => errors.push(error));
    const f = fixture();
    f.controller.restoreExpanded = async items => {
        if (items[0].id === "gone") {
            throw new Error("not found");
        }
        f.restored.push(...items);
    };
    await restoreDocTreeStateData(f.controller, [{notebookId: "box", openPaths: [], version: 2,
        expandedIDs: [{id: "gone", kind: "document"}, {id: "retained", kind: "document"}]}]);
    assert.deepEqual(f.restored.map(item => item.id), ["retained"]);
    assert.equal(errors.length, 1);
});
