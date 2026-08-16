import * as assert from "node:assert/strict";
import test from "node:test";
import {
    FILE_TREE_CHILDREN_SORT_MODE,
    FILE_TREE_EFFECTIVE_SORT_MODE,
    getConfiguredChildrenSortMode,
    getFileTreeListSortMode,
    isCustomFileTreeList,
    updateFileTreeSortMode
} from "./fileTreeSort";

const withWindow = (callback: () => void) => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            siyuan: {
                config: {fileTree: {sort: 6}},
                notebooks: [{id: "notebook", sortMode: 15}],
            },
        },
    });
    try {
        callback();
    } finally {
        if (windowDescriptor) {
            Object.defineProperty(globalThis, "window", windowDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
};

const elementWithAttrs = (attrs: Record<string, string>, notebookSortMode = "15") => ({
    getAttribute: (name: string) => attrs[name] ?? null,
    closest: () => ({
        getAttribute: (name: string) => name === "data-sortmode" ? notebookSortMode : null,
    }),
}) as unknown as Element;

test("effective list sort mode takes precedence over notebook sorting", () => withWindow(() => {
    const listElement = elementWithAttrs({[FILE_TREE_EFFECTIVE_SORT_MODE]: "3"});
    assert.equal(getFileTreeListSortMode(listElement), 3);
}));

test("notebook inheritance falls back to the global document tree sort mode", () => withWindow(() => {
    assert.equal(getFileTreeListSortMode(elementWithAttrs({})), 6);
}));

test("configured child sorting distinguishes inheritance from an explicit mode", () => withWindow(() => {
    assert.equal(getConfiguredChildrenSortMode(elementWithAttrs({[FILE_TREE_CHILDREN_SORT_MODE]: ""})), null);
    assert.equal(getConfiguredChildrenSortMode(elementWithAttrs({[FILE_TREE_CHILDREN_SORT_MODE]: "6x"})), null);
    assert.equal(getConfiguredChildrenSortMode(elementWithAttrs({[FILE_TREE_CHILDREN_SORT_MODE]: "0"})), 0);
}));

test("custom sorting checks the target list effective mode", () => withWindow(() => {
    assert.equal(isCustomFileTreeList(elementWithAttrs({[FILE_TREE_EFFECTIVE_SORT_MODE]: "6"}, "0")), true);
    assert.equal(isCustomFileTreeList(elementWithAttrs({[FILE_TREE_EFFECTIVE_SORT_MODE]: "0"}, "6")), false);
    assert.equal(isCustomFileTreeList(elementWithAttrs({[FILE_TREE_EFFECTIVE_SORT_MODE]: "6x"}, "0")), false);
}));

test("sort mode events update global and notebook fallback state", () => withWindow(() => {
    updateFileTreeSortMode({scope: "global", box: "", id: "", path: "/", sortMode: 3});
    assert.equal(window.siyuan.config.fileTree.sort, 3);
    updateFileTreeSortMode({scope: "notebook", box: "notebook", id: "", path: "/", sortMode: 6});
    assert.equal(window.siyuan.notebooks[0].sortMode, 6);
}));
