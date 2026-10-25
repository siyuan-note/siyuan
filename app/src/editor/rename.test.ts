import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {runInNewContext} from "node:vm";

test("document and notebook names preserve slash characters independently of filenames", () => {
    const source = transpileModule(readFileSync(path.resolve(__dirname, "rename.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const runtime = {siyuan: {documentAddressingVersion: 2,
        languages: {fileNameRule: "Invalid filename", _kernel: {106: "Title too long"}}}};
    let messages = 0;
    const methods = new Function("window", "Constants", "showMessage", source + "\nreturn {normalizeDocumentTitle, normalizeNotebookName, replaceFileName, validateName};")(
        runtime, {SIZE_TITLE: 512}, () => messages++);
    for (const title of ["A/B", "../Title/", "A／B/%2F", "**text**/`code`", "&amp;/literal"]) {
        assert.equal(methods.normalizeDocumentTitle(title), title);
        assert.equal(methods.normalizeNotebookName(title), title);
    }
    assert.equal(messages, 0);
    assert.equal(methods.replaceFileName("Notebook/name"), "Notebook／name");
    assert.equal(methods.normalizeDocumentTitle("First\nSecond/third"), "FirstSecond/third");
    assert.equal(methods.normalizeDocumentTitle("😀".repeat(513)), "😀".repeat(512));
    assert.equal(methods.validateName("😀".repeat(512), undefined, true), true);
    assert.equal(methods.validateName("😀".repeat(513), undefined, true), false);
    assert.equal(methods.validateName("😀".repeat(512)), true);
    assert.equal(methods.validateName("😀".repeat(513)), false);
    assert.equal(methods.normalizeNotebookName(" First\nSecond/third／ "), "FirstSecond/third／");
    assert.equal(methods.normalizeNotebookName("😀".repeat(513)), "😀".repeat(512));
    runtime.siyuan.documentAddressingVersion = 1;
    assert.equal(methods.normalizeDocumentTitle("Old/server"), "Old／server");
    assert.equal(methods.normalizeNotebookName("Notebook/name／"), "Notebook/name／");
});

test("notebook rename sends the original slashes and updates the displayed name", () => {
    const source = transpileModule(readFileSync(path.resolve(__dirname, "rename.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const runtime = {siyuan: {config: {readonly: false}, languages: {rename: "Rename"}}};
    let confirm: (value: string, dialog: typeof activeDialog) => void;
    let closed = false;
    let displayedName = "";
    const activeDialog = {element: {setAttribute: () => {}}, destroy: () => { closed = true; }};
    const renameNotebook = new Function("window", "Constants", "openInputDialog", "fetchPost", "setNotebookName",
        source + "\nreturn rename;")(runtime, {SIZE_TITLE: 512},
        (options: {onConfirm: typeof confirm}) => { confirm = options.onConfirm; return activeDialog; },
        (url: string, body: {notebook: string, name: string}, callback: () => void) => {
            assert.equal(url, "/api/notebook/renameNotebook");
            assert.deepEqual(body, {notebook: "notebook-id", name: "Research/2026／Notes"});
            callback();
        }, (id: string, name: string) => { assert.equal(id, "notebook-id"); displayedName = name; });
    renameNotebook({path: "/", notebookId: "notebook-id", name: "Old", type: "notebook"});
    confirm(" Research/2026／Notes ", activeDialog);
    assert.equal(displayedName, "Research/2026／Notes");
    assert.equal(closed, true);
});

test("document rename opens complete rich title source instead of editing the derived summary", async () => {
    const source = transpileModule(readFileSync(path.resolve(__dirname, "rename.ts"), "utf8"),
        {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText;
    const opened: unknown[] = [];
    const moduleExports: {rename?: (options: object) => void} = {};
    runInNewContext(source, {
        exports: moduleExports,
        window: {siyuan: {documentAddressingVersion: 2, config: {readonly: false}}},
        require: (name: string) => {
            if (name === "../protyle/header/documentTitleDialog") return {openDocumentTitleDialog: (options: unknown) => opened.push(options)};
            if (name === "../dialog/inputDialog") return {openInputDialog: () => assert.fail("A document summary must never become editable source")};
            return {};
        },
    });
    moduleExports.rename({path: "/document.sy", notebookId: "box", name: "Derived summary", type: "file"});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(opened.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(opened[0])), {id: "document", notebook: "box"});
});

test("failed asset rename keeps the dialog open and does not update or reload editors", async () => {
    const source = transpileModule(readFileSync(path.resolve(__dirname, "rename.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const oldWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {configurable: true, writable: true,
        value: {siyuan: {languages: {rename: "Rename", renameAssetTip: "Updates links"}}}});
    let options: {onConfirm: (value: string, activeDialog: typeof dialog) => Promise<void>};
    let closes = 0;
    let updates = 0;
    let reloads = 0;
    const dialog = {element: {setAttribute: () => {}}, destroy: () => closes++};
    const assetPath = "assets/missing.pdf?box=20261009000001-abcdefg#x";
    const renameAsset = new Function("getAssetName", "openInputDialog", "Constants", "fetchSyncPost", "getAllModels", "getAllEditor",
        source + "\nreturn renameAsset;")(() => "missing",
        (value: typeof options) => { options = value; return dialog; }, {},
        async (url: string, body: {oldPath: string, newName: string}) => {
            assert.equal(url, "/api/asset/renameAsset");
            assert.deepEqual(body, {oldPath: assetPath, newName: "renamed"});
            return {code: -1, msg: "Asset is missing", data: {closeTimeout: 5000}};
        }, () => ({asset: [{path: assetPath, update: () => updates++}]}), () => [{reload: () => reloads++}]);
    try {
        renameAsset(assetPath);
        await options.onConfirm("renamed", dialog);
        assert.equal(closes, 0);
        assert.equal(updates, 0);
        assert.equal(reloads, 0);
    } finally {
        if (oldWindow) {
            globalThis.window = oldWindow;
        } else {
            delete globalThis.window;
        }
    }
});
