import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    findMovedFileTreeItem,
    IFileTreeMove,
    insertDocumentSortPath,
    parseDocumentTabDragData,
    remapMovedPath,
    restoreMovedExpandedDocItems,
    updateMovedSubtree
} from "./fileTreeMove";

describe("parseDocumentTabDragData", () => {
    it("parses a document tab payload", () => {
        assert.deepEqual(parseDocumentTabDragData(JSON.stringify({
            rootId: "20260802120000-abcdefg",
            tabId: "tab-id",
            title: "Document",
        })), {
            rootId: "20260802120000-abcdefg",
            tabId: "tab-id",
            title: "Document",
        });
    });

    it("rejects non-document payloads", () => {
        assert.equal(parseDocumentTabDragData(JSON.stringify({
            rootId: "invalid",
            tabId: "tab-id",
            title: "Document",
        })), undefined);
    });
});

describe("insertDocumentSortPath", () => {
    it("inserts a document from another parent before the target", () => {
        assert.deepEqual(insertDocumentSortPath(
            ["/target-a.sy", "/target-b.sy"],
            "20260802120000-abcdefg",
            "/20260802120000-abcdefg.sy",
            "/target-b.sy",
            false
        ), ["/target-a.sy", "/20260802120000-abcdefg.sy", "/target-b.sy"]);
    });

    it("reorders a document already under the target parent", () => {
        assert.deepEqual(insertDocumentSortPath(
            ["/a.sy", "/20260802120000-abcdefg.sy", "/b.sy"],
            "20260802120000-abcdefg",
            "/20260802120000-abcdefg.sy",
            "/b.sy",
            true
        ), ["/a.sy", "/b.sy", "/20260802120000-abcdefg.sy"]);
    });

    it("returns undefined when the target is missing", () => {
        assert.equal(insertDocumentSortPath(
            ["/a.sy"],
            "20260802120000-abcdefg",
            "/20260802120000-abcdefg.sy",
            "/missing.sy",
            false
        ), undefined);
    });
});

const move: IFileTreeMove = {
    fromNotebook: "source-notebook",
    fromPath: "/parent/current.sy",
    toNotebook: "target-notebook",
    toPath: "/target.sy",
    newPath: "/target/current.sy",
};

const createFileTreeItem = (path: string) => {
    const properties = new Map<string, string>();
    const toggleElement = {
        style: {
            paddingLeft: "",
        },
    };
    const element = {
        dataset: {path},
        style: {
            setProperty(name: string, value: string) {
                properties.set(name, value);
            },
        },
        querySelector(selector: string) {
            return selector === ":scope > .b3-list-item__toggle" ? toggleElement : undefined;
        },
    } as unknown as HTMLElement;
    return {
        element,
        properties,
        toggleElement,
    };
};

const createFileTreeList = (items: HTMLElement[]) => ({
    tagName: "UL",
    querySelectorAll() {
        return items;
    },
}) as unknown as HTMLElement;

const createExpandableItem = (id: string, expanded: boolean, childListElement?: HTMLElement) => ({
    dataset: {nodeId: id},
    nextElementSibling: childListElement,
    querySelector(selector: string) {
        return expanded && selector === ".b3-list-item__arrow--open" ? {} : undefined;
    },
}) as unknown as HTMLElement;

describe("remapMovedPath", () => {
    it("remaps descendants when moving to another parent", () => {
        assert.equal(
            remapMovedPath("/parent/current/child.sy", "/parent/current.sy", "/target/current.sy"),
            "/target/current/child.sy"
        );
    });

    it("remaps descendants when moving to the notebook root", () => {
        assert.equal(
            remapMovedPath("/parent/current/child/grandchild.sy", "/parent/current.sy", "/current.sy"),
            "/current/child/grandchild.sy"
        );
    });

    it("does not remap paths outside the moved subtree", () => {
        assert.equal(
            remapMovedPath("/parent/current-other/child.sy", "/parent/current.sy", "/target/current.sy"),
            "/parent/current-other/child.sy"
        );
    });
});

describe("findMovedFileTreeItem", () => {
    it("uses the source item when the WebSocket event arrives first", () => {
        const sourceElement = {} as HTMLElement;
        const treeElement = {
            querySelector(selector: string) {
                return selector.includes(move.fromNotebook) ? sourceElement : undefined;
            },
        } as unknown as Element;

        assert.deepEqual(findMovedFileTreeItem(treeElement, move), {
            element: sourceElement,
            isAtTarget: false,
        });
    });

    it("uses the target item when the local move finishes first", () => {
        const targetElement = {} as HTMLElement;
        const treeElement = {
            querySelector(selector: string) {
                return selector.includes(move.toNotebook) ? targetElement : undefined;
            },
        } as unknown as Element;

        assert.deepEqual(findMovedFileTreeItem(treeElement, move), {
            element: targetElement,
            isAtTarget: true,
        });
    });
});

describe("updateMovedSubtree", () => {
    it("updates paths and indentation for the complete moved subtree", () => {
        const root = createFileTreeItem(move.fromPath);
        const child = createFileTreeItem("/parent/current/child.sy");
        const grandchild = createFileTreeItem("/parent/current/child/grandchild.sy");
        const childListElement = {
            querySelectorAll() {
                return [child.element, grandchild.element];
            },
        } as unknown as HTMLElement;

        updateMovedSubtree(root.element, childListElement, move.fromPath, move.newPath);

        assert.equal(root.element.dataset.path, move.newPath);
        assert.equal(child.element.dataset.path, "/target/current/child.sy");
        assert.equal(grandchild.element.dataset.path, "/target/current/child/grandchild.sy");
        assert.equal(root.properties.get("--file-toggle-width"), "60px");
        assert.equal(child.properties.get("--file-toggle-width"), "80px");
        assert.equal(grandchild.properties.get("--file-toggle-width"), "100px");
        assert.equal(root.toggleElement.style.paddingLeft, "40px");
        assert.equal(child.toggleElement.style.paddingLeft, "60px");
        assert.equal(grandchild.toggleElement.style.paddingLeft, "80px");
    });

    it("is idempotent when the local move and WebSocket event both update the subtree", () => {
        const root = createFileTreeItem(move.fromPath);
        const child = createFileTreeItem("/parent/current/child.sy");
        const childListElement = {
            querySelectorAll() {
                return [child.element];
            },
        } as unknown as HTMLElement;

        updateMovedSubtree(root.element, childListElement, move.fromPath, move.newPath);
        updateMovedSubtree(root.element, childListElement, move.fromPath, move.newPath);

        assert.equal(root.element.dataset.path, move.newPath);
        assert.equal(child.element.dataset.path, "/target/current/child.sy");
        assert.equal(root.properties.get("--file-toggle-width"), "60px");
        assert.equal(child.properties.get("--file-toggle-width"), "80px");
    });
});

describe("restoreMovedExpandedDocItems", () => {
    it("keeps an existing expanded subtree and restores its descendants", () => {
        const child = createExpandableItem("child", false);
        const childList = createFileTreeList([child]);
        const root = createExpandableItem("root", true, childList);
        const rootList = createFileTreeList([root]);
        const expandedDocIDs = new Set(["root", "child"]);
        const expandedItems: string[] = [];

        restoreMovedExpandedDocItems(rootList, expandedDocIDs, (item) => {
            expandedItems.push(item.dataset.nodeId);
        });

        assert.deepEqual(expandedItems, ["child"]);
        assert.equal(expandedDocIDs.size, 0);
    });

    it("restores descendants after a moved root is loaded under a collapsed target", () => {
        const root = createExpandableItem("root", false);
        const rootList = createFileTreeList([root]);
        const child = createExpandableItem("child", false);
        const childList = createFileTreeList([child]);
        const expandedDocIDs = new Set(["root", "child"]);
        const expandedItems: string[] = [];

        restoreMovedExpandedDocItems(rootList, expandedDocIDs, (item) => {
            expandedItems.push(item.dataset.nodeId);
        });
        assert.deepEqual(expandedItems, ["root"]);
        assert.deepEqual([...expandedDocIDs], ["child"]);

        restoreMovedExpandedDocItems(childList, expandedDocIDs, (item) => {
            expandedItems.push(item.dataset.nodeId);
        });
        assert.deepEqual(expandedItems, ["root", "child"]);
        assert.equal(expandedDocIDs.size, 0);
    });
});
