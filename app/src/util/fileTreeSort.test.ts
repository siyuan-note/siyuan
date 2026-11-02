import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getConfiguredChildrenSortMode, getFileTreeListSortMode, isCustomFileTreeList, updateFileTreeSortMode} from "./fileTreeSort";
import {notebookTreeItem, setDocTreeRowItem} from "../layout/dock/docTree/rowData";

test("tree sorting reads the projection and distinguishes inherited and explicit sorting", () => {
    const notebook = {id: "notebook", sortMode: 15} as INotebook;
    const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {configurable: true, value: {siyuan: {
        config: {fileTree: {sort: 6}}, notebooks: [notebook],
    }}});
    try {
        const row = {closest: () => row} as unknown as Element;
        const item = {...notebookTreeItem(notebook), effectiveSortMode: 6};
        setDocTreeRowItem(row, item);
        assert.equal(getFileTreeListSortMode(row), 6);
        assert.equal(isCustomFileTreeList(row), true);
        assert.equal(getConfiguredChildrenSortMode(row), null);
        setDocTreeRowItem(row, {...item, childrenSortMode: 0, effectiveSortMode: 0});
        assert.equal(getConfiguredChildrenSortMode(row), 0);
        assert.equal(isCustomFileTreeList(row), false);
        updateFileTreeSortMode({scope: "global", box: "", id: "", path: "", sortMode: 2});
        assert.equal(window.siyuan.config.fileTree.sort, 2);
        updateFileTreeSortMode({scope: "notebook", box: notebook.id, id: "", path: "/", sortMode: 3});
        assert.equal(notebook.sortMode, 3);
    } finally {
        if (previous) { Object.defineProperty(globalThis, "window", previous); }
        else { Reflect.deleteProperty(globalThis, "window"); }
    }
});
