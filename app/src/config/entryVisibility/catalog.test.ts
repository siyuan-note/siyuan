import * as assert from "node:assert/strict";
import test from "node:test";
import {entryCatalog, getEntryCatalogNode, getEntryParentPath, getEntryPaths} from "./catalog";

test("entry catalog paths are unique and indexed", () => {
    const paths: string[] = [];
    const visit = (prefix: string, nodes: typeof entryCatalog[number]["children"]) => {
        nodes.forEach((item) => {
            const path = `${prefix}.${item.key}`;
            paths.push(path);
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

test("simple profile follows the reviewed defaults", () => {
    const shown = [
        "document.title.copy.copyBlockEmbed",
        "document.title.export.exportTemplate",
        "document.title.export.exportImage",
        "gutter.single.addToAgent",
        "gutter.single.turnInto.code",
        "gutter.single.table.tableHeaderRow",
        "gutter.single.table.tableHeaderColumn",
        "gutter.single.table.alignTop",
        "gutter.single.table.alignMiddle",
        "gutter.single.table.alignBottom",
        "gutter.single.table.useDefaultVerticalAlign",
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
