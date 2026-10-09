import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isIfStatement, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {getEntryCatalogChildren} from "../config/entryVisibility/catalog";

const source = createSourceFile("protyle.ts", readFileSync(join(__dirname, "protyle.ts"), "utf8"), ScriptTarget.Latest, true);
const declaration = source.statements.filter(isVariableStatement).flatMap(statement =>
    Array.from(statement.declarationList.declarations)).find(item => item.name.getText(source) === "videoMenu");
const menuCode = transpileModule("const videoMenu = " + declaration.initializer.getText(source) + "; videoMenu;",
    {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;

const gutterSource = createSourceFile("gutter.ts", readFileSync(join(__dirname, "../protyle/gutter/index.ts"), "utf8"),
    ScriptTarget.Latest, true);
let gutterCode: string;
const findMediaBranch = (node: import("typescript").Node) => {
    if (isIfStatement(node) && node.expression.getText(gutterSource).includes('type === "NodeVideo"') &&
        node.expression.getText(gutterSource).includes('type === "NodeAudio"')) {
        gutterCode = transpileModule(`if (${node.expression.getText(gutterSource)}) ${node.thenStatement.getText(gutterSource)}`,
            {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
        return;
    }
    forEachChild(node, findMediaBranch);
};
findMediaBranch(gutterSource);
assert.ok(gutterCode);

const createHarness = (disabled: boolean, src: string | null, canExport = true) => {
    const exports: string[] = [];
    const mutations: string[] = [];
    const protyle = {disabled, app: {}};
    const nodeElement = {
        outerHTML: "<div></div>",
        querySelector: () => ({getAttribute: () => src, setAttribute: () => mutations.push("link")}),
    };
    const context = {
        window: {siyuan: {languages: {link: "Link", rename: "Rename", openBy: "Open", assets: "Assets"}}},
        exportAsset: (path: string) => canExport ? {id: "export", click: () => exports.push(path)} : {ignore: true},
        writeAssetToClipboard: () => ({id: "copyFile"}),
        renameAsset: () => mutations.push("rename"),
        openMenu: () => [{id: "open"}],
        updateTransaction: () => mutations.push("transaction"),
    };
    const videoMenu = runInNewContext(menuCode, context) as (editor: typeof protyle, block: typeof nodeElement,
                                                          type: string) => IMenu[];
    return {context, protyle, nodeElement, videoMenu, exports, mutations};
};

test("readonly media exports preserve asset context without exposing mutations", () => {
    const src = "assets/视频%23test.mp4?box=20261006000000-box0001#t=10";
    for (const type of ["NodeVideo", "NodeAudio"]) {
        const harness = createHarness(true, src);
        const menu = harness.videoMenu(harness.protyle, harness.nodeElement, type);
        assert.deepEqual(Array.from(menu, item => item.id), ["export"]);
        menu[0].click(null, null);
        assert.deepEqual(harness.exports, [src]);
        assert.deepEqual(harness.mutations, []);
    }
});

test("editable media retain their configured menu paths and order", () => {
    for (const type of ["NodeVideo", "NodeAudio"]) {
        const harness = createHarness(false, "assets/movie.mp4");
        const menu = harness.videoMenu(harness.protyle, harness.nodeElement, type);
        const key = type === "NodeVideo" ? "assetVideo" : "assetAudio";
        assert.deepEqual(Array.from(menu, item => item.id),
            getEntryCatalogChildren(`gutter.single.${key}`).map(item => item.key));
        menu.find(item => item.id === "rename").click(null, null);
        assert.deepEqual(harness.mutations, ["rename"]);
    }
});

test("desktop and mobile gutter menus expose readonly exports and omit empty resource groups", () => {
    for (const mobile of [false, true]) {
        for (const type of ["NodeVideo", "NodeAudio"]) {
            for (const src of ["assets/movie.mp4", "https://example.com/movie.mp4", "", null]) {
                for (const canExport of [false, true]) {
                    const harness = createHarness(true, src, canExport);
                    const items: IMenu[] = [];
                    runInNewContext(gutterCode, {
                        ...harness.context, protyle: harness.protyle, nodeElement: harness.nodeElement, type,
                        videoMenu: harness.videoMenu, isMobile: () => mobile,
                        window: {siyuan: {languages: {}, menus: {menu: {append: (item: IMenu) => items.push(item)}}}},
                        MenuItem: class {
                            element: IMenu;
                            constructor(item: IMenu) {
                                this.element = item;
                            }
                        },
                    });
                    assert.deepEqual(items.map(item => item.id), src?.startsWith("assets/") && canExport ?
                        ["separator_VideoOrAudio", type === "NodeVideo" ? "assetVideo" : "assetAudio"] : []);
                }
            }
        }
    }
});
