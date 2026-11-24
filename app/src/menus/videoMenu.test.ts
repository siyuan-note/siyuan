import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isIfStatement, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {getEntryCatalogChildren} from "../config/entryVisibility/catalog";

const source = createSourceFile("protyle.ts", readFileSync(join(__dirname, "protyle.ts"), "utf8"), ScriptTarget.Latest, true);
const declaration = source.statements.filter(isVariableStatement).flatMap(statement =>
    Array.from(statement.declarationList.declarations)).find(item => item.name.getText(source) === "videoMenu");
const menuCode = transpileModule("const videoMenu = " + declaration.initializer.getText(source) + "; videoMenu;",
    {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
const utilSource = createSourceFile("util.ts", readFileSync(join(__dirname, "util.ts"), "utf8"), ScriptTarget.Latest, true);
const utilDeclarations = utilSource.statements.filter(isVariableStatement).flatMap(statement =>
    Array.from(statement.declarationList.declarations));
const assetFunctions = ["getAssetShareItem", "getAssetExportItems", "getMediaAssetExportItems"] as const;
const assetMenuCode = transpileModule(assetFunctions.map(name =>
    "const " + utilDeclarations.find(item => item.name.getText(utilSource) === name).getText(utilSource) + ";"
).join("\n") + `\n({${assetFunctions.join(", ")}});`,
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

const createHarness = (disabled: boolean, src: string | null, canExport = true, initialLoop = false,
    platform?: "android" | "harmony" | "legacy") => {
    const exports: string[] = [];
    const shares: string[] = [];
    const saves: string[] = [];
    const mutations: string[] = [];
    const transactions: Array<{oldHTML: string; newHTML: string}> = [];
    const protyle = {disabled, app: {}};
    let loop = initialLoop;
    const media = {
        getAttribute: () => src, setAttribute: () => mutations.push("link"),
        hasAttribute: (name: string) => name === "loop" && loop,
        toggleAttribute: (name: string) => { assert.equal(name, "loop"); loop = !loop; },
    };
    const nodeElement = {
        get outerHTML() { return `<div><video src="${src}"${loop ? " loop" : ""}></video></div>`; },
        querySelector: () => media,
    };
    const shareBridge = {shareAsset: (path: string) => { shares.push(path); }};
    const window = {
        siyuan: {languages: {link: "Link", rename: "Rename", openBy: "Open", assets: "Assets", shareAsset: "Share",
            saveToGallery: "Save to Gallery"}},
        JSAndroid: platform === "android" ? {...shareBridge, saveAssetToGallery: (path: string) => { saves.push(path); }} :
            platform === "legacy" ? {} : undefined,
        JSHarmony: platform === "harmony" ? shareBridge : undefined,
    };
    const exportAsset = (path: string) => canExport ? {id: "export", click: () => exports.push(path)} : {ignore: true};
    const assetMenus = runInNewContext(assetMenuCode, {
        window, exportAsset, getHostCapabilities: () => ({importExport: canExport}),
        isInAndroid: () => platform === "android" || platform === "legacy", isInHarmony: () => platform === "harmony",
    }) as Pick<typeof import("./util"), typeof assetFunctions[number]>;
    const context = {
        window,
        ...assetMenus,
        writeAssetToClipboard: () => ({id: "copyFile"}),
        renameAsset: () => mutations.push("rename"),
        openMenu: () => [{id: "open"}],
        updateTransaction: (_editor: unknown, _block: unknown, oldHTML: string) => {
            mutations.push("transaction");
            transactions.push({oldHTML, newHTML: nodeElement.outerHTML});
        },
    };
    const videoMenu = runInNewContext(menuCode, context) as (editor: typeof protyle, block: typeof nodeElement,
                                                          type: string) => IMenu[];
    return {context, protyle, nodeElement, videoMenu, exports, shares, saves, mutations, transactions, media};
};

test("video loop toggles the saved attribute and records independent undo snapshots", () => {
    for (const initialLoop of [false, true]) {
        const harness = createHarness(false, "assets/movie.mp4", true, initialLoop);
        const initialHTML = harness.nodeElement.outerHTML;
        const menu = harness.videoMenu(harness.protyle, harness.nodeElement, "NodeVideo");
        const loop = menu.find(item => item.id === "loop");
        assert.equal(loop.checked, initialLoop);
        loop.click(null, null);
        assert.equal(harness.media.hasAttribute("loop"), !initialLoop);
        const changedHTML = harness.nodeElement.outerHTML;
        loop.click(null, null);
        assert.equal(harness.media.hasAttribute("loop"), initialLoop);
        assert.deepEqual(harness.transactions, [
            {oldHTML: initialHTML, newHTML: changedHTML},
            {oldHTML: changedHTML, newHTML: initialHTML},
        ]);
        assert.equal(harness.videoMenu(harness.protyle, harness.nodeElement, "NodeAudio").some(item => item.id === "loop"), false);
    }
});

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
        const harness = createHarness(false, "assets/movie.mp4", true, false, "android");
        const menu = harness.videoMenu(harness.protyle, harness.nodeElement, type);
        const key = type === "NodeVideo" ? "assetVideo" : "assetAudio";
        assert.deepEqual(Array.from(menu, item => item.id),
            getEntryCatalogChildren(`gutter.single.${key}`).map(item => item.key));
        menu.find(item => item.id === "rename").click(null, null);
        assert.deepEqual(harness.mutations, ["rename"]);
    }
});

test("mobile media shares the original local asset reference from readonly and editable menus", () => {
    const src = "assets/影片%23test.mp4?box=20261006000000-box0001#t=10";
    for (const platform of ["android", "harmony", "legacy", undefined] as const) {
        for (const disabled of [true, false]) {
            const harness = createHarness(disabled, src, true, false, platform);
            for (const type of ["NodeVideo", "NodeAudio"]) {
                const item = harness.videoMenu(harness.protyle, harness.nodeElement, type).find(item => item.id === "shareAsset");
                if (platform === "android" || platform === "harmony") {
                    assert.equal(item.label, "Share");
                    item.click(null, null);
                    assert.equal(harness.shares.at(-1), src);
                } else {
                    assert.equal(item, undefined);
                }
            }
            assert.equal(harness.context.getAssetShareItem("https://example.com/movie.mp4"), undefined);
        }
    }
    assert.equal(createHarness(true, src, false, false, "android").context.getAssetShareItem(src), undefined);
});

test("Android local images and videos can save the original asset to the gallery alongside export", () => {
    const video = "assets/影片%23test.mp4?box=20261006000000-box0001#t=10";
    const image = "assets/picture%25.png?box=20261006000000-box0001";
    for (const disabled of [true, false]) {
        const harness = createHarness(disabled, video, true, false, "android");
        const menu = harness.videoMenu(harness.protyle, harness.nodeElement, "NodeVideo");
        menu.find(item => item.id === "export").click(null, null);
        menu.find(item => item.id === "saveToGallery").click(null, null);
        const imageMenu = harness.context.getMediaAssetExportItems(image);
        assert.deepEqual(Array.from(imageMenu, item => item.id), ["export", "shareAsset", "saveToGallery"]);
        imageMenu.find(item => item.id === "saveToGallery").click(null, null);
        assert.deepEqual(harness.saves, [video, image]);
        assert.deepEqual(harness.exports, [video]);
        assert.equal(harness.videoMenu(harness.protyle, harness.nodeElement, "NodeAudio").some(item =>
            item.id === "saveToGallery"), false);
    }
    for (const [platform, src, canExport] of [["harmony", image, true], ["legacy", image, true], [undefined, image, true],
        ["android", image, false], ["android", "https://example.com/photo.png", true]] as const) {
        const harness = createHarness(false, src, canExport, false, platform);
        assert.equal(harness.context.getMediaAssetExportItems(src).some(item => item.id === "saveToGallery"), false);
    }
});

test("asset file menus share arbitrary file extensions with their original encoded paths", () => {
    const harness = createHarness(false, "", true, false, "android");
    for (const extension of ["pdf", "zip", "docx", "bin"]) {
        const asset = "assets/report%20100%25." + extension;
        const decoded = decodeURI(asset);
        const items = harness.context.getAssetExportItems(asset, decoded);
        assert.deepEqual(Array.from(items, item => item.id), ["export", "shareAsset"]);
        items[0].click(null, null);
        items[1].click(null, null);
        assert.equal(harness.exports.at(-1), decoded);
        assert.equal(harness.shares.at(-1), asset);
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

const browserCases = (source: string, lutePath: string) => {
    const check: typeof assert = require("node:assert/strict");
    require(lutePath);
    const lute = Lute.New();
    lute.SetProtyleWYSIWYG(true);
    lute.SetSpin(true);
    lute.SetSanitize(true);
    const holder = document.createElement("div");
    holder.innerHTML = lute.Md2BlockDOM('<video controls="controls" src="assets/movie.mp4"></video>');
    const block = holder.querySelector('[data-type="NodeVideo"]');
    check.ok(block, "standard video HTML must remain a video block");
    const snapshots: Array<{oldHTML: string; newHTML: string}> = [];
    const videoMenu = new Function("window", "updateTransaction", "openMenu", "getAssetExportItems", "writeAssetToClipboard",
        "const getMediaAssetExportItems = getAssetExportItems;\n" + source + "\nreturn videoMenu;")({siyuan: {languages: {videoLoop: "Loop"}}},
        (_editor: unknown, element: Element, oldHTML: string) => snapshots.push({oldHTML, newHTML: element.outerHTML}),
        (): IMenu[] => [], (): IMenu[] => [{id: "export"}], () => ({id: "copyFile"})) as typeof import("./protyle").videoMenu;
    const editor = {disabled: false, app: {}} as IProtyle;
    const menu = videoMenu(editor, block, "NodeVideo");
    menu.find(item => item.id === "loop").click(null, null);
    check.equal(block.querySelector("video").loop, true);
    holder.innerHTML = lute.SpinBlockDOM(snapshots[0].newHTML);
    check.equal(holder.querySelector("video").loop, true, "saving and reopening must preserve loop");
    const markdown = lute.BlockDOM2StdMd(holder.innerHTML);
    holder.innerHTML = lute.Md2BlockDOM(markdown);
    check.equal(holder.querySelector("video").loop, true, "Markdown export and import must preserve loop");
    check.equal(videoMenu(editor, holder.firstElementChild, "NodeVideo").find(item => item.id === "loop").checked, true);
    videoMenu(editor, holder.firstElementChild, "NodeVideo").find(item => item.id === "loop").click(null, null);
    check.equal(holder.querySelector("video").loop, false);
    holder.innerHTML = snapshots[1].oldHTML;
    check.equal(holder.querySelector("video").loop, true, "undo restores enabled loop");
    holder.innerHTML = snapshots[1].newHTML;
    check.equal(holder.querySelector("video").loop, false, "redo restores disabled loop");
    return "Video loop persistence passed";
};

test("video loop survives real DOM rendering, Lute round trips, export and undo snapshots", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const code = `Promise.resolve().then(() => (${browserCases.toString()})(${JSON.stringify(menuCode)},` +
        `${JSON.stringify(resolve("stage/protyle/js/lute/lute.min.js"))})).catch(error => ({error: String(error.stack || error)}))`;
    const directory = mkdtempSync(join(tmpdir(), "siyuan-video-loop-"));
    const file = join(directory, "run.cjs");
    writeFileSync(file, `const {app, BrowserWindow} = require("electron");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    await win.loadURL('data:text/html,<html><head></head><body></body></html>');
    console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
    app.exit(0);
}).catch(error => {console.error(error); app.exit(1);});`);
    try {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await promisify(execFile)(require("electron"), [file], {env, windowsHide: true, timeout: 35000});
        assert.match(result.stdout, /Video loop persistence passed/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
