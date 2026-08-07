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

test("simple profile follows the reviewed defaults", () => {
    const shown = [
        "document.title.copy.copyBlockEmbed",
        "document.title.export.exportTemplate",
        "document.title.export.exportImage",
        "gutter.single.addToAgent",
        "gutter.single.turnInto.code",
        "gutter.single.superBlock.superBlockAlignment.alignTop",
        "gutter.single.superBlock.superBlockAlignment.alignMiddle",
        "gutter.single.superBlock.superBlockAlignment.alignBottom",
        "gutter.single.superBlock.superBlockAlignment.useDefaultVerticalAlign",
        "gutter.single.table.tableHeaderRow",
        "gutter.single.table.tableHeaderColumn",
        "gutter.single.table.alignment.alignTop",
        "gutter.single.table.alignment.alignMiddle",
        "gutter.single.table.alignment.alignBottom",
        "gutter.single.table.alignment.useDefaultVerticalAlign",
        "inline.text.more.tableHeaderRow",
        "inline.text.more.tableHeaderColumn",
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
