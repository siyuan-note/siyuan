import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {ScriptTarget, transpileModule} from "typescript";

test("document titles preserve slash characters while notebook and file names retain their rules", () => {
    const source = transpileModule(readFileSync(path.resolve(__dirname, "rename.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const runtime = {siyuan: {languages: {fileNameRule: "Invalid filename", _kernel: {106: "Title too long"}}}};
    let messages = 0;
    const methods = new Function("window", "Constants", "showMessage", source + "\nreturn {normalizeDocumentTitle, replaceFileName, validateName};")(
        runtime, {SIZE_TITLE: 512}, () => messages++);
    for (const title of ["A/B", "../Title/", "A／B/%2F", "**text**/`code`", "&amp;/literal"]) {
        assert.equal(methods.normalizeDocumentTitle(title), title);
    }
    assert.equal(messages, 0);
    assert.equal(methods.replaceFileName("Notebook/name"), "Notebook／name");
    assert.equal(methods.normalizeDocumentTitle("First\nSecond/third"), "FirstSecond/third");
    assert.equal(methods.normalizeDocumentTitle("😀".repeat(513)), "😀".repeat(512));
    assert.equal(methods.validateName("😀".repeat(512), undefined, true), true);
    assert.equal(methods.validateName("😀".repeat(513), undefined, true), false);
    assert.equal(methods.validateName("😀".repeat(512)), false);
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
