import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as path from "node:path";

const load = (local = true, result = true) => {
    const exports: Record<string, any> = {};
    const calls: unknown[][] = [];
    const messages: string[] = [];
    runInNewContext(transpileModule(readFileSync("src/editor/markdownAsset.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, URL, window: {location: {origin: "http://localhost:6806"}, siyuan: {languages: {markdownLoadError: "Cannot open editor"}}},
        require: (id: string) => ({
            "../util/hostCapabilities": {getHostCapabilities: () => ({localFileSystem: local})},
            "../util/pathName": {getAssetExtension: (value: string) => path.extname(value.split(/[?#]/)[0]), isEncryptedBox: (box: string) => box === "encrypted"},
            "../dialog/message": {showMessage: (message: string) => messages.push(message)},
            "electron": {ipcRenderer: {invoke: async (...args: unknown[]) => { calls.push(args); return result; }}},
        })[id],
    });
    return {api: exports, calls, messages};
};

test("Markdown asset menu eligibility excludes remote, encrypted and nonasset links", () => {
    const {api} = load();
    for (const link of ["assets/a.md", " assets/中文.MARKDOWN?box=ordinary#heading "]) assert.equal(api.canOpenMarkdownAsset(link), true);
    for (const link of ["file:///a.md", "https://remote/assets/a.md", "assets/a.png", "assets/a.md?box=encrypted"]) assert.equal(api.canOpenMarkdownAsset(link), false);
    assert.equal(load(false).api.canOpenMarkdownAsset("assets/a.md"), false);
});

test("Markdown asset action forwards a relative link and reports rejected opens", async () => {
    const h = load();
    await h.api.openMarkdownAsset(" assets/a.md ");
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [["siyuan-open-markdown", "assets/a.md"]]);
    await h.api.openMarkdownAsset("assets/a.md?box=encrypted");
    assert.equal(h.calls.length, 1);
    const failed = load(true, false);
    await failed.api.openMarkdownAsset("assets/a.md");
    assert.deepEqual(failed.messages, ["Cannot open editor"]);
});
