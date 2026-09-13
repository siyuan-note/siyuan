import * as assert from "node:assert/strict";
import test from "node:test";
import {getVisibleFileTreeItems, selectFileTreeRange} from "./fileTreeSelection";

const fixture = () => {
    const items = Array.from({length: 5}, () => {
        const classes = new Set<string>();
        return {
            classList: {
                contains: (name: string) => classes.has(name),
                add: (name: string) => classes.add(name),
                remove: (name: string) => classes.delete(name),
            },
            getClientRects: () => [{}],
            parentElement: null,
        } as unknown as Element;
    });
    const root = {
        querySelectorAll: (selector: string) => selector === "li.b3-list-item" ? items :
            items.filter((item) => item.classList.contains("b3-list-item--focus")),
    } as unknown as HTMLElement;
    const selected = () => items.flatMap((item, index) =>
        item.classList.contains("b3-list-item--focus") ? [index] : []);
    return {items, root, selected};
};

test("successive Shift clicks expand, shrink and reverse around a fixed anchor", () => {
    const {items, root, selected} = fixture();
    let anchor = selectFileTreeRange(root, items[1], items[4]);
    assert.deepEqual(selected(), [1, 2, 3, 4]);
    anchor = selectFileTreeRange(root, anchor, items[2]);
    assert.deepEqual(selected(), [1, 2]);
    assert.equal(selectFileTreeRange(root, anchor, items[0]), items[1]);
    assert.deepEqual(selected(), [0, 1]);
});

test("first Shift click selects only its target and establishes an anchor", () => {
    const {items, root, selected} = fixture();
    const anchor = selectFileTreeRange(root, null, items[2]);
    assert.deepEqual(selected(), [2]);
    selectFileTreeRange(root, anchor, items[4]);
    assert.deepEqual(selected(), [2, 3, 4]);
});

test("detached and hidden anchors fall back to a visible selected row", () => {
    const {items, root, selected} = fixture();
    items[0].getClientRects = () => [] as unknown as DOMRectList;
    items[0].classList.add("b3-list-item--focus");
    items[2].classList.add("b3-list-item--focus");
    assert.equal(selectFileTreeRange(root, items[0], items[4]), items[2]);
    assert.deepEqual(selected(), [2, 3, 4]);
    assert.equal(selectFileTreeRange(root, {} as Element, items[3]), items[2]);
    assert.deepEqual(selected(), [2, 3]);
});

test("hidden rows are excluded and an invalid anchor without visible selection uses the target", () => {
    const {items, root, selected} = fixture();
    items[2].getClientRects = () => [] as unknown as DOMRectList;
    selectFileTreeRange(root, items[0], items[4]);
    assert.deepEqual(selected(), [0, 1, 3, 4]);
    items.forEach((item) => item.classList.remove("b3-list-item--focus"));
    assert.equal(selectFileTreeRange(root, items[2], items[3]), items[3]);
    assert.deepEqual(selected(), [3]);
});

test("descendants of collapsing lists are excluded before their DOM is removed", () => {
    const {items, root} = fixture();
    let expanded = false;
    const list = {
        tagName: "UL",
        parentElement: root,
        previousElementSibling: {
            matches: () => true,
            querySelector: () => expanded ? {} : null,
        },
    };
    Object.defineProperty(items[2], "parentElement", {value: {tagName: "UL", parentElement: list}});
    assert.deepEqual(getVisibleFileTreeItems(root), [items[0], items[1], items[3], items[4]]);
    expanded = true;
    assert.deepEqual(getVisibleFileTreeItems(root), items);
});
