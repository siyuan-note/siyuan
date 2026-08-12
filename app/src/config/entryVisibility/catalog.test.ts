import * as assert from "node:assert/strict";
import test from "node:test";
import {
    entryCatalog,
    getEntryCatalogChildren,
    getEntryCatalogNode,
    getEntryCatalogPathChain,
    getEntryCatalogSection,
    getEntryParentPath,
    getEntryOrderParents,
    getEntryPaths,
} from "./catalog";

test("entry catalog paths are unique and indexed", () => {
    const paths: string[] = [];
    const visit = (prefix: string, nodes: typeof entryCatalog[number]["children"]) => {
        nodes.forEach((item) => {
            const path = `${prefix}.${item.key}`;
            if (item.type === "entry") {
                paths.push(path);
            }
            assert.equal(getEntryCatalogNode(path), item);
            assert.equal(getEntryParentPath(path), prefix);
            if (item.children) {
                visit(path, item.children);
            }
        });
    };
    entryCatalog.forEach((section) => visit(section.key, section.children));
    assert.equal(new Set(paths).size, paths.length);
    assert.deepEqual(new Set(getEntryPaths()), new Set(paths));
});

test("conditional block resource menus have distinct configuration labels", () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            siyuan: {
                languages: {
                    assets: "Assets",
                    audio: "Audio",
                    video: "Video",
                },
            },
        },
    });
    try {
        assert.equal(getEntryCatalogNode("gutter.single.assetVideo")?.label(), "Video - Assets");
        assert.equal(getEntryCatalogNode("gutter.single.assetAudio")?.label(), "Audio - Assets");
        assert.equal(getEntryCatalogNode("gutter.single.assetIFrame")?.label(), "IFrame - Assets");
    } finally {
        if (windowDescriptor) {
            Object.defineProperty(globalThis, "window", windowDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});

test("sortable entry catalog groups contain valid separator positions", () => {
    getEntryOrderParents().forEach((parentPath) => {
        const children = getEntryCatalogChildren(parentPath);
        assert.ok(children.length > 0, parentPath);
        assert.notEqual(children[0].type, "separator", parentPath);
        assert.notEqual(children[children.length - 1].type, "separator", parentPath);
        children.forEach((item, index) => {
            if (item.type === "separator") {
                assert.notEqual(children[index - 1]?.type, "separator", parentPath);
            }
        });
        assert.equal(new Set(children.map((item) => item.key)).size, children.length, parentPath);
    });
});

test("list block submenu follows the base block entries", () => {
    const children = getEntryCatalogChildren("gutter.single");
    const deleteIndex = children.findIndex((item) => item.key === "delete");
    const separator = children[deleteIndex + 1];
    const listBlock = children[deleteIndex + 2];

    assert.ok(0 <= deleteIndex);
    assert.equal(separator?.key, "separator_listBlock");
    assert.equal(separator?.type, "separator");
    assert.equal(listBlock?.key, "listBlock");
    assert.equal(listBlock?.type, "entry");
    assert.equal(listBlock?.simple, true);
    assert.deepEqual(listBlock?.children?.map((item) => item.key), ["prependListItem", "appendListItem"]);
});

test("super block actions and vertical alignment use their respective menu groups", () => {
    assert.deepEqual(getEntryCatalogChildren("gutter.single.superBlock").map((item) => item.key), [
        "cancelSuperBlock",
        "turnIntoVLayout",
        "turnIntoHLayout",
    ]);

    const singleLayoutKeys = getEntryCatalogChildren("gutter.single.layout").map((item) => item.key);
    const horizontalSeparatorIndex = singleLayoutKeys.indexOf("separator_1");
    assert.deepEqual(singleLayoutKeys.slice(horizontalSeparatorIndex + 1, horizontalSeparatorIndex + 6), [
        "alignTop",
        "alignMiddle",
        "alignBottom",
        "useDefaultVerticalAlign",
        "separator_verticalAlign",
    ]);
    assert.equal(getEntryCatalogChildren("gutter.multi.layout").some((item) => item.key === "alignTop"), false);
});

test("multiple block heading transform follows the regular transform menu", () => {
    const children = getEntryCatalogChildren("gutter.multi");

    assert.deepEqual(children.slice(0, 3).map((item) => item.key), [
        "turnInto",
        "tWithSubtitle",
        "mergeSuperBlock",
    ]);
    assert.deepEqual(getEntryCatalogChildren("gutter.multi.tWithSubtitle").map((item) => item.key), [
        "heading1",
        "heading2",
        "heading3",
        "heading4",
        "heading5",
        "heading6",
    ]);
});

test("document loading actions follow the document menu order", () => {
    const children = getEntryCatalogChildren("document.more");
    const loadAllIndex = children.findIndex((item) => item.key === "loadAllContent");

    assert.ok(0 <= loadAllIndex);
    assert.equal(children[loadAllIndex + 1]?.key, "keepLazyLoad");
    assert.equal(children[loadAllIndex + 2]?.key, "separator_1");
});

test("multiple document and notebook entries follow their document tree menus", () => {
    assert.deepEqual(getEntryCatalogChildren("docTree.notebooks").map((item) => item.key), ["close", "delete"]);
    assert.ok(getEntryCatalogChildren("docTree.multi").some((item) => item.key === "delete"));
});

test("multiple document and notebook settings have distinct labels", () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            siyuan: {
                languages: {
                    agentCatDoc: "Document",
                    agentCatNotebook: "Notebook",
                    entryDocPanel: "Document panel",
                    more: "More",
                    multiSelect: "Multi-select",
                },
            },
        },
    });
    try {
        assert.equal(entryCatalog.find((item) => item.key === "docTree.multi")?.label(),
            "Document panel - Document - Multi-select - More");
        assert.equal(entryCatalog.find((item) => item.key === "docTree.notebooks")?.label(),
            "Document panel - Notebook - Multi-select - More");
    } finally {
        if (windowDescriptor) {
            Object.defineProperty(globalThis, "window", windowDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});

test("HTML file insertion follows general asset insertion", () => {
    const children = getEntryCatalogChildren("document.more");
    const insertAssetIndex = children.findIndex((item) => item.key === "insertAsset");

    assert.ok(0 <= insertAssetIndex);
    assert.equal(children[insertAssetIndex + 1]?.key, "insertHTMLFile");
});

test("simple profile follows the reviewed defaults", () => {
    const shown = [
        "document.title.copy.copyBlockEmbed",
        "document.title.export.exportTemplate",
        "document.title.export.exportImage",
        "gutter.single.addToAgent",
        "gutter.single.turnInto.code",
        "gutter.single.layout.alignTop",
        "gutter.single.layout.alignMiddle",
        "gutter.single.layout.alignBottom",
        "gutter.single.layout.useDefaultVerticalAlign",
        "gutter.single.table.tableHeaderRow",
        "gutter.single.table.tableHeaderColumn",
        "gutter.single.table.alignment.alignTop",
        "gutter.single.table.alignment.alignMiddle",
        "gutter.single.table.alignment.alignBottom",
        "gutter.single.table.alignment.useDefaultVerticalAlign",
        "inline.text.more.tableHeaderRow",
        "inline.text.more.tableHeaderColumn",
        "document.more.loadAllContent",
        "document.more.keepLazyLoad",
        "document.more.headingNumber",
        "docTree.notebook.sort.fileNameNatASC",
    ];
    const hidden = [
        "document.title.copy.copyDoc",
        "document.title.copy.copyProtocol",
        "gutter.single.addToDatabase",
        "gutter.single.enterBack",
        "gutter.single.jumpTo",
        "gutter.single.wechatReminder",
        "document.more.netAssets2LocalAssets",
        "document.more.fullWidth",
        "docTree.notebook.sort.fileNameASC",
        "inline.image.copyFile",
    ];
    shown.forEach((path) => assert.equal(getEntryCatalogNode(path)?.simple, true, path));
    hidden.forEach((path) => assert.equal(getEntryCatalogNode(path)?.simple, false, path));
});

test("entry catalog resolves navigation columns for deeply nested entries", () => {
    assert.equal(getEntryCatalogSection("gutter.single"), entryCatalog.find((item) => item.key === "gutter.single"));
    assert.deepEqual(getEntryCatalogPathChain("gutter.single",
        "gutter.single.turnInto.includeSublists.recursiveParagraph"), [
        "gutter.single.turnInto",
        "gutter.single.turnInto.includeSublists",
        "gutter.single.turnInto.includeSublists.recursiveParagraph",
    ]);
    assert.deepEqual(getEntryCatalogPathChain("document.title",
        "gutter.single.turnInto.includeSublists.recursiveParagraph"), []);
    assert.deepEqual(getEntryCatalogPathChain("gutter.single", "gutter.single.missing"), []);
});
