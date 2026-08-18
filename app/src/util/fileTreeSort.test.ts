import * as assert from "node:assert/strict";
import test from "node:test";
import {
    FILE_TREE_CHILDREN_SORT_MODE,
    FILE_TREE_EFFECTIVE_SORT_MODE,
    getConfiguredChildrenSortMode,
    getFileTreeSortRefreshTargets,
    getFileTreeListSortMode,
    getMovedFileTreeSortRefreshTargets,
    isCustomFileTreeList,
    reorderFileTreeNotebooks,
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

interface ITreeElement {
    tagName: string;
    attrs: Record<string, string>;
    children: ITreeElement[];
    parent?: ITreeElement;
    getAttribute: (name: string) => string | null;
    setAttribute: (name: string, value: string) => void;
    append: (child: ITreeElement) => void;
}

const treeElement = (tagName: string, attrs: Record<string, string> = {}, children: Element[] = []) => {
    const element: ITreeElement = {
        tagName,
        attrs,
        children: children as unknown as ITreeElement[],
        getAttribute(name: string) {
            return this.attrs[name] ?? null;
        },
        setAttribute(name: string, value: string) {
            this.attrs[name] = value;
        },
        append(child: ITreeElement) {
            if (child.parent) {
                const index = child.parent.children.indexOf(child);
                child.parent.children.splice(index, 1);
            }
            child.parent = this;
            this.children.push(child);
        },
    };
    Object.defineProperties(element, {
        firstElementChild: {
            get: () => element.children[0] || null,
        },
        nextElementSibling: {
            get: () => {
                if (!element.parent) {
                    return null;
                }
                const index = element.parent.children.indexOf(element);
                return element.parent.children[index + 1] || null;
            },
        },
    });
    children.forEach((child) => {
        (child as unknown as ITreeElement).parent = element;
    });
    return element as unknown as Element;
};

const fileTreeFixture = () => {
    const inheritedList = treeElement("UL");
    const inherited = treeElement("LI", {
        "data-type": "navigation-file",
        "data-node-id": "inherited",
        "data-path": "/parent/inherited.sy",
        [FILE_TREE_CHILDREN_SORT_MODE]: "",
    });
    const overriddenList = treeElement("UL");
    const overridden = treeElement("LI", {
        "data-type": "navigation-file",
        "data-node-id": "overridden",
        "data-path": "/parent/overridden.sy",
        [FILE_TREE_CHILDREN_SORT_MODE]: "3",
    });
    const parentList = treeElement("UL", {}, [inherited, inheritedList, overridden, overriddenList]);
    const parent = treeElement("LI", {
        "data-type": "navigation-file",
        "data-node-id": "parent",
        "data-path": "/parent.sy",
        [FILE_TREE_CHILDREN_SORT_MODE]: "",
    });
    const rootList = treeElement("UL", {}, [parent, parentList]);
    const root = treeElement("LI", {"data-type": "navigation-root", "data-path": "/"});
    const notebook = treeElement("UL", {"data-url": "notebook", "data-sortmode": "15"}, [root, rootList]);
    const explicitRootList = treeElement("UL");
    const explicitRoot = treeElement("LI", {"data-type": "navigation-root", "data-path": "/"});
    const explicitNotebook = treeElement("UL", {"data-url": "explicit", "data-sortmode": "6"}, [
        explicitRoot,
        explicitRootList,
    ]);
    return {
        element: treeElement("DIV", {}, [notebook, explicitNotebook]),
        notebook,
        overridden,
        parent,
    };
};

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

test("document sorting refreshes expanded inherited lists up to an override", () => {
    const fixture = fileTreeFixture();
    assert.deepEqual(getFileTreeSortRefreshTargets(fixture.element, [{
        scope: "document",
        box: "notebook",
        id: "parent",
        path: "/parent.sy",
        sortMode: 2,
    }]), [
        {notebookId: "notebook", path: "/parent.sy"},
        {notebookId: "notebook", path: "/parent/inherited.sy"},
    ]);
});

test("moving a document refreshes only expanded inherited lists in the moved subtree", () => {
    const fixture = fileTreeFixture();
    assert.deepEqual(getMovedFileTreeSortRefreshTargets(fixture.element, [{
        fromNotebook: "notebook",
        fromPath: "/source/parent.sy",
        toNotebook: "notebook",
        toPath: "/",
        newPath: "/parent.sy",
    }]), [
        {notebookId: "notebook", path: "/parent.sy"},
        {notebookId: "notebook", path: "/parent/inherited.sy"},
    ]);
});

test("moving a document within the same parent does not refresh inherited sorting", () => {
    const fixture = fileTreeFixture();
    assert.deepEqual(getMovedFileTreeSortRefreshTargets(fixture.element, [{
        fromNotebook: "notebook",
        fromPath: "/parent.sy",
        toNotebook: "notebook",
        toPath: "/",
        newPath: "/parent.sy",
    }]), []);
});

test("moving a document with an explicit sorting rule does not refresh its subtree", () => {
    const fixture = fileTreeFixture();
    assert.deepEqual(getMovedFileTreeSortRefreshTargets(fixture.element, [{
        fromNotebook: "notebook",
        fromPath: "/source/overridden.sy",
        toNotebook: "notebook",
        toPath: "/parent.sy",
        newPath: "/parent/overridden.sy",
    }]), []);
});

test("moving a document across notebooks refreshes inherited sorting", () => {
    const fixture = fileTreeFixture();
    assert.deepEqual(getMovedFileTreeSortRefreshTargets(fixture.element, [{
        fromNotebook: "source",
        fromPath: "/parent.sy",
        toNotebook: "notebook",
        toPath: "/",
        newPath: "/parent.sy",
    }]), [
        {notebookId: "notebook", path: "/parent.sy"},
        {notebookId: "notebook", path: "/parent/inherited.sy"},
    ]);
});

test("global sorting refreshes only notebooks that inherit the panel rule", () => {
    const fixture = fileTreeFixture();
    assert.deepEqual(getFileTreeSortRefreshTargets(fixture.element, [{
        scope: "global",
        box: "",
        id: "",
        path: "/",
        sortMode: 2,
    }]), [
        {notebookId: "notebook", path: "/"},
        {notebookId: "notebook", path: "/parent.sy"},
        {notebookId: "notebook", path: "/parent/inherited.sy"},
    ]);
});

test("sort mode events update rendered notebook and document declarations", () => withWindow(() => {
    const fixture = fileTreeFixture();
    updateFileTreeSortMode({
        scope: "notebook",
        box: "notebook",
        id: "",
        path: "/",
        sortMode: 6,
    }, fixture.element);
    assert.equal(fixture.notebook.getAttribute("data-sortmode"), "6");
    updateFileTreeSortMode({
        scope: "document",
        box: "notebook",
        id: "parent",
        path: "/parent.sy",
        sortMode: null,
    }, fixture.element);
    assert.equal(fixture.parent.getAttribute(FILE_TREE_CHILDREN_SORT_MODE), "");
}));

test("notebook reordering moves existing opened and closed elements", () => {
    const openedA = treeElement("UL", {"data-url": "a"});
    const openedB = treeElement("UL", {"data-url": "b"});
    const closedA = treeElement("LI", {"data-url": "c"});
    const closedB = treeElement("LI", {"data-url": "d"});
    const opened = treeElement("DIV", {}, [openedA, openedB]);
    const closed = treeElement("UL", {}, [closedA, closedB]);
    reorderFileTreeNotebooks(opened, closed, [
        {id: "b", closed: false},
        {id: "a", closed: false},
        {id: "d", closed: true},
        {id: "c", closed: true},
    ]);
    assert.deepEqual(Array.from(opened.children).map((item) => item.getAttribute("data-url")), ["b", "a"]);
    assert.deepEqual(Array.from(closed.children).map((item) => item.getAttribute("data-url")), ["d", "c"]);
});
